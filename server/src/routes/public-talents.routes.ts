import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { prisma } from '../lib/prisma.js'
import { requireRole } from '../middleware/rbac.js'
import {
  PUBLIC_REF_PATTERN,
  publicTalentListQuerySchema,
  talentContactRequestInputSchema,
} from '../lib/validation.js'
import { findPublicEntry, getPublicTalent, listPublicTalents, stillPublicRefs } from '../lib/public-talents.js'
import { clip, notifyAgents, notifyUser, roleLabel, scheduleAdminNotification } from '../lib/notify.js'

/**
 * Vitrine publique « Talents recommandés » (`/api/talents-recommandes`).
 * Lecture SANS authentification. Décision 2026-11-16 : tout talent
 * recommandé apparaît (profil créé par un agent ou simple signal), chaque
 * réponse passant par la liste blanche de `lib/public-talents.ts`.
 *
 * Contact : OffRec reste l'intermédiaire obligatoire. Un utilisateur
 * connecté (hors agent et admin) décrit son besoin ; l'agent du talent (ou,
 * pour un signal, l'agent qui le tient — sinon le pool des agents) traite la
 * demande et organise le contact hors ligne. Le talent n'est jamais mis en
 * relation directement par la plateforme.
 */
const router = Router()

/** Rôles qui peuvent demander un contact : tous sauf agent et admin. */
const REQUESTER_ROLES = ['candidate', 'recruiter', 'particulier', 'talent'] as const

/** Plafond par utilisateur et par 24 h (en base), en plus du limiteur IP. */
const MAX_REQUESTS_PER_DAY = 5

const readLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes. Réessayez dans quelques minutes.' },
})

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de demandes envoyées. Réessayez dans quelques minutes.' },
})

const NOT_FOUND = { error: 'Ce talent n’est pas (ou plus) présenté publiquement.' }

router.get('/', readLimiter, async (req, res, next) => {
  try {
    const query = publicTalentListQuerySchema.parse(req.query)
    const result = await listPublicTalents(query)
    // Un retrait d'accord doit prendre effet immédiatement : pas de cache.
    res.set('Cache-Control', 'no-store')
    res.json(result)
  } catch (err) {
    next(err)
  }
})

/**
 * Demandes de contact de l'utilisateur connecté (statut seulement). Déclarée
 * avant `/:publicRef` ; le lien vers la fiche n'est donné que si elle est
 * encore publique.
 */
router.get('/mes-demandes', requireRole(...REQUESTER_ROLES), async (req, res, next) => {
  try {
    const requests = await prisma.talentContactRequest.findMany({
      where: { requesterId: req.session!.sub },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        need: true,
        status: true,
        createdAt: true,
        handledAt: true,
        talentId: true,
        signalId: true,
        talent: { select: { trade: true, city: true, district: true } },
        signal: { select: { trade: true, city: true, district: true } },
      },
    })
    const refOf = await stillPublicRefs(
      [...new Set(requests.flatMap((r) => (r.talentId ? [r.talentId] : [])))],
      [...new Set(requests.flatMap((r) => (!r.talentId && r.signalId ? [r.signalId] : [])))],
    )
    res.json({
      requests: requests.map((r) => {
        const subject = r.talent ?? r.signal
        const key = r.talentId ?? r.signalId
        return {
          id: r.id,
          need: r.need,
          status: r.status,
          createdAt: r.createdAt.toISOString(),
          handledAt: r.handledAt?.toISOString() ?? null,
          talent: {
            trade: subject?.trade ?? 'Talent recommandé',
            city: subject?.city ?? '',
            district: subject?.district ?? null,
            publicRef: key ? (refOf.get(key) ?? null) : null,
          },
        }
      }),
    })
  } catch (err) {
    next(err)
  }
})

router.get('/:publicRef', readLimiter, async (req, res, next) => {
  try {
    const ref = req.params.publicRef
    const talent = PUBLIC_REF_PATTERN.test(ref) ? await getPublicTalent(ref) : null
    res.set('Cache-Control', 'no-store')
    if (!talent) {
      res.status(404).json(NOT_FOUND)
      return
    }
    res.json({ talent })
  } catch (err) {
    next(err)
  }
})

router.post('/:publicRef/contact', contactLimiter, requireRole(...REQUESTER_ROLES), async (req, res, next) => {
  try {
    const ref = req.params.publicRef
    const entry = PUBLIC_REF_PATTERN.test(ref) ? await findPublicEntry(ref) : null
    if (!entry) {
      res.status(404).json(NOT_FOUND)
      return
    }
    const body = talentContactRequestInputSchema.parse(req.body)
    const me = req.session!.sub
    if (entry.accountUserId === me) {
      res.status(400).json({ error: 'Vous ne pouvez pas demander à être mis en contact avec vous-même.' })
      return
    }
    // Profil : la demande vise le talent. Signal non converti : elle vise le
    // signal (`talentId` renseigné à la conversion, suit une fusion).
    const target = entry.kind === 'talent' ? { talentId: entry.id } : { signalId: entry.id }
    const since = new Date(Date.now() - 24 * 3600 * 1000)
    const [open, lastDay] = await Promise.all([
      prisma.talentContactRequest.count({
        where: { requesterId: me, ...target, status: { in: ['nouvelle', 'transmise'] } },
      }),
      prisma.talentContactRequest.count({ where: { requesterId: me, createdAt: { gte: since } } }),
    ])
    if (open > 0) {
      res.status(409).json({ error: 'Vous avez déjà une demande en cours pour ce talent : un agent OffRec la traite.' })
      return
    }
    if (lastDay >= MAX_REQUESTS_PER_DAY) {
      res.status(429).json({ error: `${MAX_REQUESTS_PER_DAY} demandes de contact par jour au maximum. Réessayez demain.` })
      return
    }
    const request = await prisma.talentContactRequest.create({
      data: { ...target, requesterId: me, need: body.need },
      select: { id: true, status: true, createdAt: true },
    })
    await prisma.auditLog.create({
      data: {
        userId: me,
        action: 'talent_contact_requested',
        metadata: { ...target, requestId: request.id },
      },
    })
    res.status(201).json({
      request: { id: request.id, status: request.status, createdAt: request.createdAt.toISOString() },
      message: 'Demande envoyée : un agent OffRec vous recontacte pour organiser la mise en relation.',
    })
    // Ni le nom du talent, ni celui du demandeur, ni le besoin (texte libre) :
    // ils se lisent dans « Demandes de contact ».
    const who = roleLabel(req.session!.role)
    const place = `${clip(entry.source.trade, 40)}, ${clip(entry.source.city, 40)}`
    if (entry.agentId) {
      void notifyUser({
        userId: entry.agentId,
        event: 'talent_contact_requested',
        title: 'Nouvelle demande de contact',
        message: `${who} souhaite contacter un talent que vous suivez (${place}) via la vitrine. Organisez la mise en relation.`,
        link: '/agent/demandes-talents',
      })
    } else {
      // Signal sans agent : le pool des agents (de la province, sinon tous).
      void notifyAgents({
        event: 'talent_contact_requested',
        province: entry.province ?? '',
        title: 'Demande de contact à prendre',
        message: `${who} souhaite contacter un talent recommandé (${place}) qu’aucun agent ne suit encore. Le premier agent disponible organise la mise en relation.`,
        link: '/agent/demandes-talents',
      })
    }
    scheduleAdminNotification({
      event: 'talent_contact_requested',
      category: 'agent',
      title: 'Demande de contact d’un talent',
      message: `${who} a demandé à contacter un talent de la vitrine (${place}). ${entry.agentId ? 'Son agent' : 'Un agent du pool'} doit traiter la demande.`,
      link: '/admin/talents',
    })
  } catch (err) {
    next(err)
  }
})

export default router
