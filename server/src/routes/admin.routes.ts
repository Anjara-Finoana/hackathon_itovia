import bcrypt from 'bcryptjs'
import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireRole } from '../middleware/rbac.js'
import {
  adminHiringStatsQuerySchema,
  adminPublicVisibilitySchema,
  adminSignalVisibilitySchema,
  createAgentSchema,
  cvVerifierRolesSchema,
  moderationResolveSchema,
  researchExportSchema,
} from '../lib/validation.js'
import { PUBLIC_SIGNAL_WHERE, PUBLIC_TALENT_WHERE } from '../lib/public-talents.js'
import { clip, notifyUser } from '../lib/notify.js'
import { GRANTABLE_CV_VERIFIER_ROLES, listCvVerifierRoles } from '../lib/cv-access.js'
import { loadSignalTrust, loadTalentTrust, verificationSummary } from '../lib/talent-trust.js'
import { purgeExpiredSignalsLazily } from '../lib/talent-signals.js'
import { loadAdminDashboard } from '../lib/admin-dashboard.js'
import { buildAdminResearchExport, loadAdminHiringStats } from '../lib/hiring-stats.js'
import { HIRING_UNAVAILABLE_ERROR } from '../lib/hiring-store.js'

const ACTION_TO_STATUS = {
  warning: 'warned',
  restriction: 'restricted',
  suspension: 'suspended',
  ban: 'banned',
} as const

const router = Router()

router.use(requireRole('admin'))

router.get('/stats', async (req, res, next) => {
  try {
    const [
      candidateCount,
      recruiterCount,
      individualCount,
      agentCount,
      opportunityCount,
      applicationCount,
      providerCount,
      recommendationCount,
      memberCount,
      openReportCount,
    ] = await Promise.all([
      prisma.user.count({ where: { role: 'candidate' } }),
      prisma.user.count({ where: { role: 'recruiter' } }),
      prisma.user.count({ where: { role: 'particulier' } }),
      prisma.user.count({ where: { role: 'agent' } }),
      prisma.opportunity.count(),
      prisma.application.count(),
      prisma.provider.count(),
      prisma.recommendation.count(),
      prisma.member.count(),
      prisma.report.count({ where: { status: 'open' } }),
    ])
    // Le journal d'activité n'est plus sur le tableau de bord : il a sa page
    // dédiée (`GET /admin/activity`, écran « Activité »).

    const [payingSubscriptions, revenueAgg] = await Promise.all([
      prisma.subscription.count({ where: { planCode: { not: 'FREE' } } }),
      prisma.transaction.aggregate({ _sum: { amountAr: true }, _count: true }),
    ])

    // KPI d'inclusion féminine (cahier des charges §4, §10) : part de femmes
    // parmi les profils « recommandés » — candidats ayant postulé au moins
    // une fois, et talents non-diplômés recommandés/placés par un agent.
    const [candidatesWithApplications, talentsRecommended, placementsByStage, activeRecruiters] =
      await Promise.all([
        prisma.application.findMany({
          distinct: ['candidateId'],
          select: { candidate: { select: { candidateProfile: { select: { gender: true } } } } },
        }),
        prisma.talentProfile.findMany({
          where: { status: { in: ['recommande', 'place'] } },
          select: { gender: true },
        }),
        prisma.placement.groupBy({ by: ['stage'], _count: true }),
        prisma.opportunity.findMany({ distinct: ['recruiterId'], select: { recruiterId: true } }),
      ])
    const genderPool = [
      ...candidatesWithApplications
        .map((c) => c.candidate.candidateProfile?.gender)
        .filter((g): g is 'femme' | 'homme' | 'autre' => Boolean(g)),
      ...talentsRecommended.map((t) => t.gender),
    ]
    const femalePercent =
      genderPool.length > 0
        ? Math.round((genderPool.filter((g) => g === 'femme').length / genderPool.length) * 1000) / 10
        : 0
    const placementCount = placementsByStage.reduce((sum, p) => sum + p._count, 0)

    // Indicateurs du tableau de bord (séries 30 jours, tendances 7 jours,
    // files à traiter…) : ajoutés à côté des champs historiques, inchangés.
    const dashboard = await loadAdminDashboard(req.session!.sub)

    res.json({
      ...dashboard,
      users: {
        candidates: candidateCount,
        recruiters: recruiterCount,
        individuals: individualCount,
        agents: agentCount,
      },
      opportunities: opportunityCount,
      applications: applicationCount,
      providers: providerCount,
      recommendations: recommendationCount,
      members: memberCount,
      openReports: openReportCount,
      revenue: {
        payingRecruiters: payingSubscriptions,
        totalAr: revenueAgg._sum.amountAr ?? 0,
        transactionCount: revenueAgg._count,
      },
      employment: {
        femalePercent,
        genderPoolSize: genderPool.length,
        placements: placementCount,
        placementsByStage: Object.fromEntries(placementsByStage.map((p) => [p.stage, p._count])),
        activePartnerCompanies: activeRecruiters.length,
      },
    })
  } catch (err) {
    next(err)
  }
})

/**
 * Entonnoir de recrutement de toute la plateforme (sous-lot 7,
 * lib/hiring-stats.ts) : cohorte des dossiers transmis pendant la période,
 * suivis jusqu'à l'embauche, filtrable par recruteur, par offre et sans les
 * comptes de test ; indicateur « issue renseignée sous 7 jours » (plan §11).
 */
router.get('/stats/hiring', async (req, res, next) => {
  try {
    const query = adminHiringStatsQuerySchema.parse(req.query)
    const stats = await loadAdminHiringStats(query)
    res.setHeader('Cache-Control', 'no-store')
    if (!stats) {
      res.status(503).json({ error: HIRING_UNAVAILABLE_ERROR })
      return
    }
    res.json(stats)
  } catch (err) {
    next(err)
  }
})

/**
 * Export de recherche pseudonymisé (mémoire, chapitre évaluation) : une
 * ligne par dossier transmis, sans nom, email, téléphone, entreprise, note,
 * texte libre, salaire, date exacte ni identifiant interne. POST : chaque
 * export est journalisé (`research_export`, volume et filtre seulement).
 */
router.post('/stats/research-export', async (req, res, next) => {
  try {
    const { excludeTest } = researchExportSchema.parse(req.body ?? {})
    const result = await buildAdminResearchExport(req.session!.sub, excludeTest)
    res.setHeader('Cache-Control', 'no-store')
    if (!result) {
      res.status(503).json({ error: HIRING_UNAVAILABLE_ERROR })
      return
    }
    res.json(result)
  } catch (err) {
    next(err)
  }
})

/**
 * Provisionne un compte agent : pas de self-service (cahier des charges §12
 * — un statut de vérification agent non fiable détruirait la promesse
 * « compétences vérifiées »).
 */
router.post('/agents', async (req, res, next) => {
  try {
    const body = createAgentSchema.parse(req.body)
    const existing = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } })
    if (existing) {
      res.status(409).json({ error: 'Un compte existe déjà avec cet email.' })
      return
    }
    const passwordHash = await bcrypt.hash(body.password, 12)
    const user = await prisma.user.create({
      data: {
        email: body.email.toLowerCase(),
        passwordHash,
        role: 'agent',
        agentProfile: { create: body.agentProfile },
      },
      include: { agentProfile: true },
    })
    await prisma.auditLog.create({
      data: { userId: req.session!.sub, action: 'admin:create_agent', metadata: { agentUserId: user.id } },
    })
    res.status(201).json({
      agent: { id: user.id, email: user.email, agentProfile: user.agentProfile },
    })
  } catch (err) {
    next(err)
  }
})

/**
 * Talents (lecture seule — seul l'agent qui suit un talent le crée et le
 * modifie, §7.3.14) : statut, agent, accord, dernière vérification et
 * confiance calculée côté serveur. Ni téléphone ni empreinte.
 */
router.get('/talents', async (_req, res, next) => {
  try {
    const talents = await prisma.talentProfile.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        agent: { select: { id: true, email: true, agentProfile: { select: { fullName: true } } } },
        verifications: { orderBy: { verifiedAt: 'desc' }, take: 1 },
        _count: { select: { verifications: true, proposals: true, placements: true } },
      },
    })
    const [trust, visible, openRequests] = await Promise.all([
      loadTalentTrust(talents.map((t) => t.id)),
      prisma.talentProfile.findMany({ where: PUBLIC_TALENT_WHERE, select: { id: true } }),
      prisma.talentContactRequest.groupBy({ by: ['talentId'], where: { status: { in: ['nouvelle', 'transmise'] } }, _count: { _all: true } }),
    ])
    const visibleIds = new Set(visible.map((v) => v.id))
    const openByTalent = new Map(openRequests.map((g) => [g.talentId, g._count._all]))
    res.json({
      talents: talents.map((t) => ({
        id: t.id,
        fullName: t.fullName,
        trade: t.trade,
        sector: t.sector,
        province: t.province,
        city: t.city,
        district: t.district,
        status: t.status,
        createdAt: t.createdAt.toISOString(),
        consentAt: t.consentAt?.toISOString() ?? null,
        // Accord de visibilité publique (vitrine) : donné, et réellement en
        // ligne (toutes les conditions de `PUBLIC_TALENT_WHERE` réunies).
        publicConsentAt: t.publicConsentAt?.toISOString() ?? null,
        publicRef: t.publicRef,
        publicVisible: visibleIds.has(t.id),
        // Masquage admin de la vitrine (décision 2026-11-16).
        publicHiddenAt: t.publicHiddenAt?.toISOString() ?? null,
        openContactRequests: openByTalent.get(t.id) ?? 0,
        agent: { id: t.agent.id, name: t.agent.agentProfile?.fullName ?? t.agent.email },
        verification: verificationSummary(t.verifications[0]),
        verificationCount: t._count.verifications,
        proposalCount: t._count.proposals,
        placementCount: t._count.placements,
        trust: trust.get(t.id)!.trust,
      })),
    })
  } catch (err) {
    next(err)
  }
})

/**
 * Modération de la vitrine. `{ granted: false }` : retire l'accord public
 * (accord et `publicRef` effacés, ancien lien mort) ET masque la fiche — un
 * talent recommandé resterait sinon publié (décision 2026-11-16).
 * `{ hidden: true | false }` : masque ou réaffiche sans toucher à l'accord ;
 * l'admin ne donne jamais un accord à la place de la personne.
 */
router.put('/talents/:id/public-visibility', async (req, res, next) => {
  try {
    const body = adminPublicVisibilitySchema.parse(req.body)
    const talent = await prisma.talentProfile.findUnique({
      where: { id: req.params.id },
      select: { id: true, agentId: true, trade: true, city: true, publicConsentAt: true, publicHiddenAt: true },
    })
    if (!talent) {
      res.status(404).json({ error: 'Talent introuvable.' })
      return
    }
    const me = req.session!.sub
    const hide = 'granted' in body ? true : body.hidden
    if ('granted' in body && talent.publicConsentAt) {
      await prisma.$transaction([
        prisma.talentProfile.update({ where: { id: talent.id }, data: { publicConsentAt: null, publicRef: null } }),
        prisma.auditLog.create({ data: { userId: me, action: 'talent_consent_public_revoked', metadata: { talentId: talent.id } } }),
      ])
    }
    if (hide !== Boolean(talent.publicHiddenAt)) {
      await prisma.$transaction([
        prisma.talentProfile.update({ where: { id: talent.id }, data: { publicHiddenAt: hide ? new Date() : null } }),
        prisma.auditLog.create({
          data: { userId: me, action: hide ? 'talent_public_hidden' : 'talent_public_unhidden', metadata: { talentId: talent.id } },
        }),
      ])
      void notifyUser({
        userId: talent.agentId,
        event: hide ? 'talent_public_revoked_by_admin' : 'talent_public_restored_by_admin',
        title: hide ? 'Fiche publique retirée' : 'Fiche publique réaffichée',
        message: hide
          ? `Un administrateur a retiré de la vitrine la fiche d’un de vos talents (${clip(talent.trade, 40)}, ${clip(talent.city, 40)}).`
          : `Un administrateur a réaffiché dans la vitrine la fiche d’un de vos talents (${clip(talent.trade, 40)}, ${clip(talent.city, 40)}).`,
        link: `/agent/talents/${talent.id}`,
      })
    }
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

/**
 * Masquer / réafficher un signal dans la vitrine (décision 2026-11-16). Le
 * masquage suit le signal à sa conversion (repris par le profil créé).
 */
router.put('/talent-signals/:id/public-visibility', async (req, res, next) => {
  try {
    const { hidden } = adminSignalVisibilitySchema.parse(req.body)
    const signal = await prisma.talentSignal.findUnique({
      where: { id: req.params.id },
      select: { id: true, publicHiddenAt: true },
    })
    if (!signal) {
      res.status(404).json({ error: 'Signal introuvable.' })
      return
    }
    if (hidden !== Boolean(signal.publicHiddenAt)) {
      const me = req.session!.sub
      await prisma.$transaction([
        prisma.talentSignal.update({ where: { id: signal.id }, data: { publicHiddenAt: hidden ? new Date() : null } }),
        prisma.auditLog.create({
          data: { userId: me, action: hidden ? 'talent_public_hidden' : 'talent_public_unhidden', metadata: { signalId: signal.id } },
        }),
      ])
    }
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

/**
 * Vue d'ensemble des signaux « talent recommandé » (toutes files, tous
 * agents), contact compris : l'admin le voit, il n'est jamais public. Purge
 * paresseuse des signaux expirés comme pour la file des agents.
 */
router.get('/talent-signals', async (req, res, next) => {
  try {
    await purgeExpiredSignalsLazily()
    const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : undefined
    const [signals, grouped] = await Promise.all([
      prisma.talentSignal.findMany({
        where: status ? { status: status as never } : undefined,
        orderBy: { createdAt: 'desc' },
        take: 300,
        include: { agent: { select: { email: true, agentProfile: { select: { fullName: true } } } } },
      }),
      prisma.talentSignal.groupBy({ by: ['status'], _count: { _all: true } }),
    ])
    const [trust, publicCandidates] = await Promise.all([
      loadSignalTrust(signals.map((s) => s.id)),
      prisma.talentSignal.findMany({
        where: { ...PUBLIC_SIGNAL_WHERE, id: { in: signals.map((s) => s.id) } },
        select: { id: true },
      }),
    ])
    const publicIds = new Set(publicCandidates.map((p) => p.id))
    res.json({
      counts: Object.fromEntries(grouped.map((g) => [g.status, g._count._all])),
      signals: signals.map((s) => {
        const t = trust.get(s.id)!
        return {
          id: s.id,
          trade: s.trade,
          sector: s.sector,
          province: s.province,
          city: s.city,
          district: s.district,
          status: s.status,
          createdAt: s.createdAt.toISOString(),
          expiresAt: s.expiresAt.toISOString(),
          contactPurged: s.contactPurgedAt !== null,
          subjectName: s.subjectName,
          contactPhone: s.contactPhone,
          contactHint: s.contactHint,
          agentName: s.agent ? (s.agent.agentProfile?.fullName ?? s.agent.email) : null,
          talentId: s.talentId,
          mergedIntoId: s.mergedIntoId,
          endorsementCount: t.trust.recommendationCount,
          trust: t.trust,
          // Vitrine (décision 2026-11-16) : en ligne, masquée par un admin.
          publicRef: s.publicRef,
          publicVisible: publicIds.has(s.id) && t.rows.some((r) => !r.excludedAt),
          publicHiddenAt: s.publicHiddenAt?.toISOString() ?? null,
        }
      }),
    })
  } catch (err) {
    next(err)
  }
})

router.get('/reports', async (_req, res, next) => {
  try {
    const reports = await prisma.report.findMany({
      where: { status: 'open' },
      orderBy: { createdAt: 'desc' },
      include: {
        reporter: { select: { email: true } },
        targetUser: { select: { email: true, role: true, status: true } },
      },
    })
    // Fiche publique de talent : libellé lisible (métier, lieu, état public).
    const talentIds = reports.filter((r) => r.targetType === 'talent').map((r) => r.targetId)
    const talents = talentIds.length
      ? await prisma.talentProfile.findMany({
          where: { id: { in: talentIds } },
          select: { id: true, trade: true, city: true, district: true, publicHiddenAt: true },
        })
      : []
    // Depuis le 2026-11-16, `targetId` peut aussi être l'id d'un signal
    // (entrée de la vitrine sans profil).
    const signalTargets = talentIds.length
      ? await prisma.talentSignal.findMany({
          where: { id: { in: talentIds } },
          select: { id: true, trade: true, city: true, district: true, publicHiddenAt: true },
        })
      : []
    const talentLabel = new Map<string, string>([
      ...talents.map((t): [string, string] => [
        t.id,
        `${t.trade} · ${t.district ? `${t.district}, ` : ''}${t.city}${t.publicHiddenAt ? ' (fiche déjà masquée)' : ''}`,
      ]),
      ...signalTargets.map((t): [string, string] => [
        t.id,
        `Signal · ${t.trade} · ${t.district}, ${t.city}${t.publicHiddenAt ? ' (fiche déjà masquée)' : ''}`,
      ]),
    ])
    // Fiche entreprise : nom et ville (masquée ou non).
    const companyIds = reports.filter((r) => r.targetType === 'company').map((r) => r.targetId)
    const companies = companyIds.length
      ? await prisma.company.findMany({
          where: { id: { in: companyIds } },
          select: { id: true, name: true, city: true, hiddenAt: true },
        })
      : []
    const companyLabel = new Map(
      companies.map((c) => [c.id, `${c.name} · ${c.city}${c.hiddenAt ? ' (fiche déjà masquée)' : ''}`]),
    )
    res.json({
      reports: reports.map((r) => ({
        id: r.id,
        targetType: r.targetType,
        targetId: r.targetId,
        targetLabel:
          r.targetType === 'talent'
            ? (talentLabel.get(r.targetId) ?? null)
            : r.targetType === 'company'
              ? (companyLabel.get(r.targetId) ?? null)
              : null,
        reason: r.reason,
        createdAt: r.createdAt.toISOString(),
        reporterEmail: r.reporter.email,
        targetUser: r.targetUser
          ? { email: r.targetUser.email, role: r.targetUser.role, status: r.targetUser.status }
          : null,
      })),
    })
  } catch (err) {
    next(err)
  }
})

/**
 * Résout un signalement : classe sans suite (dismiss) ou applique une étape
 * du pipeline Warning -> Restriction -> Suspension -> Bannissement. L'humain
 * (l'admin) décide ; ce n'est jamais une IA qui bannit à sa place.
 */
router.post('/reports/:id/resolve', async (req, res, next) => {
  try {
    const body = moderationResolveSchema.parse(req.body)
    const report = await prisma.report.findUnique({ where: { id: req.params.id } })
    if (!report || report.status !== 'open') {
      res.status(404).json({ error: 'Signalement introuvable ou déjà traité.' })
      return
    }

    await prisma.moderationAction.create({
      data: {
        reportId: report.id,
        adminId: req.session!.sub,
        targetUserId: report.targetUserId,
        action: body.action,
        note: body.note,
      },
    })
    await prisma.report.update({ where: { id: report.id }, data: { status: 'resolved' } })

    if (body.action !== 'dismiss' && report.targetUserId) {
      await prisma.user.update({
        where: { id: report.targetUserId },
        data: { status: ACTION_TO_STATUS[body.action] },
      })
    }

    await prisma.auditLog.create({
      data: {
        userId: req.session!.sub,
        action: `moderation:${body.action}`,
        metadata: { reportId: report.id, targetUserId: report.targetUserId },
      },
    })

    res.status(204).end()
  } catch (err) {
    next(err)
  }
})

/**
 * Rôles habilités à vérifier les CV candidats en plus de l'admin. Seuls les
 * rôles de `GRANTABLE_CV_VERIFIER_ROLES` peuvent l'être (jamais candidat,
 * talent ni recruteur — voir lib/cv-access.ts).
 */
router.get('/cv-verifier-roles', async (_req, res, next) => {
  try {
    res.json({ roles: await listCvVerifierRoles(), grantable: GRANTABLE_CV_VERIFIER_ROLES })
  } catch (err) {
    next(err)
  }
})

router.put('/cv-verifier-roles', async (req, res, next) => {
  try {
    const body = cvVerifierRolesSchema.parse(req.body)
    const roles = Array.from(new Set(body.roles))
    const refused = roles.filter((role) => !GRANTABLE_CV_VERIFIER_ROLES.includes(role))
    if (refused.length > 0) {
      res.status(400).json({
        error: `Ce rôle ne peut pas être habilité à vérifier les CV : ${refused.join(', ')}.`,
      })
      return
    }

    const previous = await listCvVerifierRoles()
    await prisma.$transaction([
      prisma.cvVerifierRole.deleteMany({ where: { role: { notIn: roles } } }),
      // `upsert` sans mise à jour : un rôle déjà habilité garde sa date et son auteur d'origine.
      ...roles.map((role) =>
        prisma.cvVerifierRole.upsert({
          where: { role },
          create: { role, grantedById: req.session!.sub },
          update: {},
        }),
      ),
      prisma.auditLog.create({
        data: {
          userId: req.session!.sub,
          action: 'admin:cv_verifier_roles',
          metadata: { previous, roles },
        },
      }),
    ])

    res.json({ roles: await listCvVerifierRoles(), grantable: GRANTABLE_CV_VERIFIER_ROLES })
  } catch (err) {
    next(err)
  }
})

export default router
