import { Router } from 'express'
import type { ContactRequestStatus, Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { contactRequestListQuerySchema, contactRequestStatusSchema } from '../lib/validation.js'
import { clip, notifyUser, roleLabel } from '../lib/notify.js'

/**
 * Demandes de contact reçues via la vitrine « Talents recommandés » (monté
 * sous `/api/agent`, rôle agent). Un agent voit les demandes visant SES
 * talents, les signaux qu'il tient, et — décision 2026-11-16 — le pool des
 * demandes visant un signal qu'aucun agent ne tient encore (le premier qui
 * la fait avancer la traite). Il organise le contact hors ligne : la
 * plateforme ne transmet jamais les coordonnées du talent au demandeur.
 */
const router = Router()

/** Demandes visibles par l'agent `me` (seule définition, liste et mise à jour). */
function visibleTo(me: string): Prisma.TalentContactRequestWhereInput {
  return {
    OR: [
      { talent: { agentId: me } },
      { talentId: null, signal: { agentId: me } },
      { talentId: null, signal: { agentId: null } },
    ],
  }
}

/** `nouvelle → transmise → close`, ou `nouvelle → close` (demande sans suite). */
const ALLOWED: Record<ContactRequestStatus, ContactRequestStatus[]> = {
  nouvelle: ['transmise', 'close'],
  transmise: ['close'],
  close: [],
}

const requestInclude = {
  talent: { select: { id: true, fullName: true, trade: true, city: true, district: true, agentId: true } },
  signal: {
    select: { id: true, subjectName: true, trade: true, city: true, district: true, agentId: true, status: true },
  },
  requester: {
    select: {
      role: true,
      email: true,
      candidateProfile: { select: { fullName: true, phone: true } },
      recruiterProfile: { select: { companyName: true, phone: true } },
      individualProfile: { select: { fullName: true, phone: true } },
      talentAccountProfile: { select: { fullName: true, phone: true } },
    },
  },
} as const

type Row = Awaited<ReturnType<typeof loadOne>>

function loadOne(id: string) {
  return prisma.talentContactRequest.findUnique({ where: { id }, include: requestInclude })
}

/** Vue agent : le demandeur avec ses coordonnées (l'agent organise le contact). */
function agentView(r: NonNullable<Row>) {
  const q = r.requester
  const profile = q.candidateProfile ?? q.individualProfile ?? q.talentAccountProfile
  return {
    id: r.id,
    status: r.status,
    need: r.need,
    createdAt: r.createdAt.toISOString(),
    handledAt: r.handledAt?.toISOString() ?? null,
    // Profil (agent du talent) ou signal non converti (agent qui le tient, ou
    // pool) : le nom donné par les recommandeurs est public depuis le
    // 2026-11-16 ; le téléphone se lit sur la fiche du signal.
    talent: r.talent
      ? {
          id: r.talent.id,
          fullName: r.talent.fullName,
          trade: r.talent.trade,
          city: r.talent.city,
          district: r.talent.district ?? null,
        }
      : null,
    signal:
      !r.talent && r.signal
        ? {
            id: r.signal.id,
            subjectName: r.signal.subjectName,
            trade: r.signal.trade,
            city: r.signal.city,
            district: r.signal.district,
            status: r.signal.status,
            pool: r.signal.agentId === null,
          }
        : null,
    requester: {
      role: q.role,
      roleLabel: roleLabel(q.role),
      name: q.recruiterProfile?.companyName ?? profile?.fullName ?? null,
      email: q.email,
      phone: q.recruiterProfile?.phone ?? profile?.phone ?? null,
    },
  }
}

router.get('/contact-requests', async (req, res, next) => {
  try {
    const { status } = contactRequestListQuerySchema.parse(req.query)
    const me = req.session!.sub
    const [requests, grouped] = await Promise.all([
      prisma.talentContactRequest.findMany({
        where: { ...visibleTo(me), ...(status ? { status } : {}) },
        include: requestInclude,
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      prisma.talentContactRequest.groupBy({
        by: ['status'],
        where: visibleTo(me),
        _count: { _all: true },
      }),
    ])
    res.json({
      counts: Object.fromEntries(grouped.map((g) => [g.status, g._count._all])),
      requests: requests.map(agentView),
    })
  } catch (err) {
    next(err)
  }
})

router.patch('/contact-requests/:id', async (req, res, next) => {
  try {
    const me = req.session!.sub
    const visible = await prisma.talentContactRequest.findFirst({
      where: { id: req.params.id, ...visibleTo(me) },
      select: { id: true },
    })
    const existing = visible ? await loadOne(visible.id) : null
    // 404 (pas 403) pour la demande d'un talent suivi par un autre agent : on
    // ne révèle pas son existence.
    if (!existing) {
      res.status(404).json({ error: 'Demande introuvable.' })
      return
    }
    const { status } = contactRequestStatusSchema.parse(req.body)
    if (!ALLOWED[existing.status].includes(status)) {
      res.status(409).json({ error: 'Ce changement de statut n’est pas possible pour cette demande.' })
      return
    }
    const now = new Date()
    const updated = await prisma.talentContactRequest.updateMany({
      where: { id: existing.id, status: existing.status },
      data: { status, handledById: me, handledAt: now },
    })
    if (updated.count === 0) {
      res.status(409).json({ error: 'La demande a changé entre-temps : rechargez la page.' })
      return
    }
    await prisma.auditLog.create({
      data: {
        userId: me,
        action: `talent_contact_request_${status}`,
        metadata: {
          requestId: existing.id,
          ...(existing.talent ? { talentId: existing.talent.id } : { signalId: existing.signalId }),
        },
      },
    })
    const fresh = await loadOne(existing.id)
    res.json({ request: agentView(fresh!) })
    const subject = existing.talent ?? existing.signal
    if (status === 'transmise') {
      // Le demandeur apprend que sa demande avance — jamais le nom ni le
      // contact du talent : l'agent l'appelle hors ligne.
      void notifyUser({
        userId: existing.requesterId,
        event: 'talent_contact_request_transmitted',
        title: 'Votre demande de contact avance',
        message:
          `L’agent OffRec a transmis votre demande au talent (${clip(subject?.trade ?? 'talent recommandé', 40)}, ${clip(subject?.city ?? '', 40)}). ` +
          'Il vous recontacte pour organiser la mise en relation.',
        link: '/talents#mes-demandes',
      })
    }
  } catch (err) {
    next(err)
  }
})

export default router
