import { randomInt } from 'node:crypto'
import type { Prisma, TalentProfile, TalentSignalStatus } from '@prisma/client'
import { prisma } from './prisma.js'
import { loadSignalTrust, loadTalentTrust, type TalentTrustEntry } from './talent-trust.js'
import { madagascarMonth, toPublicEndorsement } from './public-endorsements.js'
import { compareSubjectTrust } from '../../../src/lib/trust.js'
import { TALENT_HIGHLIGHTS } from '../../../src/data/endorsements.js'
import type {
  EndorsementRelation,
  PublicTalent,
  PublicTalentDetail,
  SubjectTrust,
} from '../../../src/types/index.js'

export { madagascarMonth } from './public-endorsements.js'

/**
 * Vitrine « Talents recommandés » : ce qui sort d'ici est PUBLIC (aucune
 * authentification). Décision 2026-11-16 : tout talent recommandé y figure
 * dès la première recommandation — profil créé par un agent (`TalentProfile`)
 * ou simple signal (`TalentSignal`) —, sans attendre l'agent ni l'accord du
 * talent. Chaque réponse est construite par LISTE BLANCHE explicite
 * (`buildPublicTalent`) — jamais un spread d'objet Prisma : nom, métier,
 * lieu, niveau, nombre de recommandations et de sources, points forts,
 * vérification. JAMAIS de téléphone (`contactPhone`, `phoneKey`), d'indice de
 * contact, d'empreinte d'auteur, de photo de preuve, d'id interne ni d'agent.
 */

/** Comptes qui ont perdu l'accès (même définition que `isAccountBlocked()`). */
const BLOCKED_STATUSES = ['suspended', 'banned'] as const

/**
 * Ancienne voie (avant 2026-11-16), conservée : accord public explicite,
 * accord de création tracé, au moins une vérification, agent actif.
 */
const CONSENT_PATH = {
  publicConsentAt: { not: null },
  consentAt: { not: null },
  verifications: { some: {} },
  agent: { status: { notIn: [...BLOCKED_STATUSES] } },
} satisfies Prisma.TalentProfileWhereInput

/** Décision 2026-11-16 : au moins une recommandation non écartée rattachée au profil. */
const RECOMMENDED_PATH = {
  signals: { some: { endorsements: { some: { excludedAt: null } } } },
} satisfies Prisma.TalentProfileWhereInput

/**
 * Seule définition de « profil visible dans la vitrine » : non masqué par un
 * admin (`publicHiddenAt`), compte de suivi du talent ni suspendu ni banni,
 * et recommandé (voie 2026-11-16) OU publié avec accord (ancienne voie). Le
 * `publicRef` est attribué paresseusement s'il manque (`ensurePublicRefs`).
 */
export const PUBLIC_TALENT_WHERE = {
  publicHiddenAt: null,
  NOT: { accountProfile: { is: { user: { status: { in: [...BLOCKED_STATUSES] } } } } },
  OR: [CONSENT_PATH, RECOMMENDED_PATH],
} satisfies Prisma.TalentProfileWhereInput

/**
 * Statuts d'un signal présenté dans la vitrine. `refuse` : écarté par un
 * agent, jamais publié. `fusionne` : seule la cible est publiée (ses
 * recommandations comprennent celles des signaux fusionnés). `converti` :
 * c'est le `TalentProfile` qui est publié (jamais de doublon). `expire` :
 * reste publié, contact et nom purgés (« Talent recommandé »).
 */
export const PUBLIC_SIGNAL_STATUSES: TalentSignalStatus[] = ['nouveau', 'pris_en_charge', 'injoignable', 'expire']

/**
 * Signal candidat à la vitrine. La condition « au moins une recommandation
 * non écartée dans la famille » est vérifiée après chargement de la
 * confiance (`loadSignalTrust`, signaux fusionnés compris).
 */
export const PUBLIC_SIGNAL_WHERE = {
  status: { in: PUBLIC_SIGNAL_STATUSES },
  mergedIntoId: null,
  talentId: null,
  publicHiddenAt: null,
} satisfies Prisma.TalentSignalWhereInput

const REF_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'

/**
 * Identifiant public aléatoire (10 caractères, sans caractères ambigus),
 * unique parmi les profils ET les signaux (un même lien ne désigne jamais
 * deux entrées).
 */
export async function newPublicRef(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    let ref = ''
    for (let i = 0; i < 10; i++) ref += REF_ALPHABET[randomInt(REF_ALPHABET.length)]
    const [talent, signal] = await Promise.all([
      prisma.talentProfile.findUnique({ where: { publicRef: ref }, select: { id: true } }),
      prisma.talentSignal.findUnique({ where: { publicRef: ref }, select: { id: true } }),
    ])
    if (!talent && !signal) return ref
  }
  throw new Error('Impossible de générer un identifiant public unique.')
}

/** Ligne de recommandation lue pour la vitrine (jamais renvoyée telle quelle). */
interface PublicRow {
  authorMemberId: string
  relation: EndorsementRelation
  highlights: string[]
  comment: string | null
  excludedAt: Date | null
  createdAt: Date
}

/** Mêmes règles que `evaluateSubject` : écartées retirées, une par auteur (la plus récente), plus récentes d'abord. */
function retained<T extends PublicRow>(rows: T[]): T[] {
  const seen = new Set<string>()
  return rows
    .filter((r) => !r.excludedAt)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .filter((r) => {
      if (seen.has(r.authorMemberId)) return false
      seen.add(r.authorMemberId)
      return true
    })
}

/** Les 3 points forts les plus cités (recommandations retenues), ex aequo dans l'ordre de la liste fermée. */
function topHighlightsOf(rows: PublicRow[], max = 3): string[] {
  const order = new Map<string, number>(TALENT_HIGHLIGHTS.map((h, i) => [h, i]))
  const counts = new Map<string, number>()
  for (const r of retained(rows)) {
    for (const h of new Set(r.highlights)) {
      if (order.has(h)) counts.set(h, (counts.get(h) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || order.get(a[0])! - order.get(b[0])!)
    .slice(0, max)
    .map(([h]) => h)
}

/** Compatibilité : points forts d'un profil à partir de son entrée de confiance. */
export function topHighlights(entry: TalentTrustEntry | undefined, max = 3): string[] {
  return topHighlightsOf(entry?.rows ?? [], max)
}

/** Source interne d'une entrée publique (serveur seulement). */
interface PublicSource {
  publicRef: string | null
  name: string | null
  trade: string
  sector: PublicTalent['sector']
  city: string
  district: string | null
  lastVerifiedAt: Date | null
}

/** LISTE BLANCHE des champs publics — tout ajout ici est une décision de confidentialité. */
function buildPublicTalent(s: PublicSource, trust: SubjectTrust | undefined, rows: PublicRow[]): PublicTalent {
  const name = s.name?.trim()
  return {
    publicRef: s.publicRef ?? '',
    name: name ? name : null,
    trade: s.trade,
    sector: s.sector,
    city: s.city,
    district: s.district || null,
    level: trust?.level ?? 'nouveau',
    recommendationCount: trust?.recommendationCount ?? 0,
    independentSources: trust?.independentSources ?? 0,
    highlights: topHighlightsOf(rows),
    verified: s.lastVerifiedAt !== null,
    verifiedMonth: s.lastVerifiedAt ? madagascarMonth(s.lastVerifiedAt) : null,
  }
}

/** Recommandations publiées d'une entrée (auteur jamais exposé). */
function publicRecommendations(rows: PublicRow[]) {
  return retained(rows).map(toPublicEndorsement)
}

type ProfileSource = Pick<TalentProfile, 'fullName' | 'trade' | 'sector' | 'city' | 'district'> & {
  publicRef: string | null
  lastVerifiedAt: Date | null
}

/** Vue publique d'un profil (aperçu agent compris) — même liste blanche que la vitrine. */
export function toPublicTalent(t: ProfileSource, entry: TalentTrustEntry | undefined): PublicTalent {
  return buildPublicTalent(
    {
      publicRef: t.publicRef,
      name: t.fullName,
      trade: t.trade,
      sector: t.sector,
      city: t.city,
      district: t.district ?? null,
      lastVerifiedAt: t.lastVerifiedAt,
    },
    entry?.trust,
    entry?.rows ?? [],
  )
}

/* ------------------------------------------------------------------ */
/* Chargement                                                          */
/* ------------------------------------------------------------------ */

const profileSelect = {
  id: true,
  fullName: true,
  trade: true,
  sector: true,
  city: true,
  district: true,
  publicRef: true,
  publicConsentAt: true,
  createdAt: true,
  agentId: true,
  agent: { select: { status: true } },
  accountProfile: { select: { userId: true } },
  verifications: { select: { verifiedAt: true }, orderBy: { verifiedAt: 'desc' }, take: 1 },
} as const

const signalSelect = {
  id: true,
  subjectName: true,
  trade: true,
  sector: true,
  city: true,
  district: true,
  province: true,
  publicRef: true,
  createdAt: true,
  agentId: true,
} as const

/** Entrée interne de la vitrine : la partie `view` seule est publique. */
export interface PublicEntry {
  kind: 'talent' | 'signal'
  /** Id interne du profil ou du signal — jamais renvoyé au client. */
  id: string
  /** Agent qui traite les demandes de contact (`null` : pool des agents). */
  agentId: string | null
  /** Compte de suivi du talent (anti-auto-contact). */
  accountUserId: string | null
  province: string | null
  sortDate: Date
  trust: SubjectTrust
  rows: PublicRow[]
  source: PublicSource
}

/** Attribue un `publicRef` aux entrées qui n'en ont pas encore (écriture conditionnelle, sans course). */
async function ensurePublicRefs(entries: PublicEntry[]): Promise<void> {
  for (const e of entries) {
    if (e.source.publicRef) continue
    const ref = await newPublicRef()
    const where = { id: e.id, publicRef: null }
    const updated =
      e.kind === 'talent'
        ? await prisma.talentProfile.updateMany({ where, data: { publicRef: ref } })
        : await prisma.talentSignal.updateMany({ where, data: { publicRef: ref } })
    if (updated.count === 1) {
      e.source.publicRef = ref
    } else {
      const fresh =
        e.kind === 'talent'
          ? await prisma.talentProfile.findUnique({ where: { id: e.id }, select: { publicRef: true } })
          : await prisma.talentSignal.findUnique({ where: { id: e.id }, select: { publicRef: true } })
      e.source.publicRef = fresh?.publicRef ?? null
    }
  }
}

type ProfileRow = Prisma.TalentProfileGetPayload<{ select: typeof profileSelect }>
type SignalRow = Prisma.TalentSignalGetPayload<{ select: typeof signalSelect }>

async function profileEntries(profiles: ProfileRow[]): Promise<PublicEntry[]> {
  const trust = await loadTalentTrust(profiles.map((t) => t.id))
  return profiles.map((t) => {
    const entry = trust.get(t.id)!
    const agentActive = !(BLOCKED_STATUSES as readonly string[]).includes(t.agent.status)
    return {
      kind: 'talent' as const,
      id: t.id,
      agentId: agentActive ? t.agentId : null,
      accountUserId: t.accountProfile?.userId ?? null,
      province: null,
      sortDate: t.publicConsentAt ?? t.createdAt,
      trust: entry.trust,
      rows: entry.rows,
      source: {
        publicRef: t.publicRef,
        name: t.fullName,
        trade: t.trade,
        sector: t.sector,
        city: t.city,
        district: t.district ?? null,
        lastVerifiedAt: t.verifications[0]?.verifiedAt ?? null,
      },
    }
  })
}

async function signalEntries(signals: SignalRow[]): Promise<PublicEntry[]> {
  const trust = await loadSignalTrust(signals.map((s) => s.id))
  return signals
    .map((s) => {
      const t = trust.get(s.id)!
      return {
        kind: 'signal' as const,
        id: s.id,
        agentId: s.agentId,
        accountUserId: null,
        province: s.province,
        sortDate: s.createdAt,
        trust: t.trust,
        rows: t.rows,
        source: {
          publicRef: s.publicRef,
          name: s.subjectName,
          trade: s.trade,
          sector: s.sector,
          city: s.city,
          district: s.district,
          lastVerifiedAt: null,
        },
      }
    })
    .filter((e) => e.rows.some((r) => !r.excludedAt))
}

/** Toutes les entrées visibles (profils et signaux), `publicRef` garanti. */
async function loadPublicEntries(): Promise<PublicEntry[]> {
  const [profiles, signals] = await Promise.all([
    prisma.talentProfile.findMany({ where: PUBLIC_TALENT_WHERE, select: profileSelect }),
    prisma.talentSignal.findMany({ where: PUBLIC_SIGNAL_WHERE, select: signalSelect }),
  ])
  const entries = [...(await profileEntries(profiles)), ...(await signalEntries(signals))]
  await ensurePublicRefs(entries)
  return entries.filter((e) => e.source.publicRef)
}

export interface PublicTalentFilters {
  trade?: string
  city?: string
  limit: number
}

const same = (a: string, b: string) => a.toLocaleLowerCase('fr') === b.toLocaleLowerCase('fr')

/**
 * Liste publique, triée par confiance seule (`compareSubjectTrust`), puis
 * ordre stable et déterministe : entrée la plus ancienne d'abord (accord
 * public, sinon création), puis `publicRef`. Les talents « Nouveau » forment
 * une section à part (jamais pénalisés, jamais mêlés aux recommandés).
 */
export async function listPublicTalents(filters: PublicTalentFilters) {
  const all = await loadPublicEntries()
  const ranked = all
    .filter((e) => (!filters.trade || same(e.source.trade, filters.trade)) && (!filters.city || same(e.source.city, filters.city)))
    .sort(
      (a, b) =>
        compareSubjectTrust(a.trust, b.trust) ||
        a.sortDate.getTime() - b.sortDate.getTime() ||
        a.source.publicRef!.localeCompare(b.source.publicRef!),
    )
    .map((e) => buildPublicTalent(e.source, e.trust, e.rows))
  const recommended = ranked.filter((p) => p.level !== 'nouveau')
  const newcomers = ranked.filter((p) => p.level === 'nouveau')
  const uniqueSorted = (values: string[]) =>
    [...new Map(values.filter(Boolean).map((v) => [v.toLocaleLowerCase('fr'), v])).values()].sort((a, b) =>
      a.localeCompare(b, 'fr'),
    )
  return {
    recommended: recommended.slice(0, filters.limit),
    newcomers: newcomers.slice(0, filters.limit),
    total: { recommended: recommended.length, newcomers: newcomers.length },
    filters: {
      trades: uniqueSorted(all.map((e) => e.source.trade)),
      cities: uniqueSorted(all.map((e) => e.source.city)),
    },
  }
}

/**
 * Entrée visible par `publicRef` (profil d'abord, sinon signal), avec les
 * données internes utiles au serveur (id, agent) ; `null` si elle n'est pas
 * (ou plus) publique.
 */
export async function findPublicEntry(publicRef: string): Promise<PublicEntry | null> {
  const profile = await prisma.talentProfile.findFirst({
    where: { ...PUBLIC_TALENT_WHERE, publicRef },
    select: profileSelect,
  })
  if (profile) return (await profileEntries([profile]))[0] ?? null
  const signal = await prisma.talentSignal.findFirst({
    where: { ...PUBLIC_SIGNAL_WHERE, publicRef },
    select: signalSelect,
  })
  if (signal) return (await signalEntries([signal]))[0] ?? null
  return null
}

/** Fiche publique détaillée par `publicRef` (carte + recommandations publiées), `null` sinon. */
export async function getPublicTalent(publicRef: string): Promise<PublicTalentDetail | null> {
  const e = await findPublicEntry(publicRef)
  if (!e) return null
  return { ...buildPublicTalent(e.source, e.trust, e.rows), recommendations: publicRecommendations(e.rows) }
}

/** `publicRef` encore publics parmi des profils et des signaux donnés (suivi des demandes). */
export async function stillPublicRefs(talentIds: string[], signalIds: string[]) {
  const [talents, signals] = await Promise.all([
    talentIds.length
      ? prisma.talentProfile.findMany({
          where: { ...PUBLIC_TALENT_WHERE, id: { in: talentIds }, publicRef: { not: null } },
          select: { id: true, publicRef: true },
        })
      : [],
    signalIds.length
      ? prisma.talentSignal.findMany({
          where: { ...PUBLIC_SIGNAL_WHERE, id: { in: signalIds }, publicRef: { not: null } },
          select: { id: true, publicRef: true },
        })
      : [],
  ])
  return new Map<string, string>([...talents, ...signals].map((t) => [t.id, t.publicRef!]))
}

/**
 * Pour l'agent (aperçu) et le compte talent : la fiche est-elle visible, et
 * sinon pourquoi. `visible` suit `PUBLIC_TALENT_WHERE` (recommandé OU accord
 * public) ; `blockers` décrit seulement l'ancienne voie par accord.
 */
export async function publicVisibilityState(talentId: string) {
  const t = await prisma.talentProfile.findUnique({
    where: { id: talentId },
    select: {
      consentAt: true,
      publicConsentAt: true,
      publicRef: true,
      publicHiddenAt: true,
      agent: { select: { status: true } },
      accountProfile: { select: { user: { select: { status: true } } } },
      _count: { select: { verifications: true } },
    },
  })
  if (!t) return null
  const blocked = (s: string | undefined) => s !== undefined && (BLOCKED_STATUSES as readonly string[]).includes(s)
  const blockers: string[] = []
  if (t.publicHiddenAt) blockers.push('Fiche masquée de la vitrine par un administrateur.')
  if (!t.consentAt) blockers.push('L’accord de création du profil n’est pas tracé (profil antérieur).')
  if (t._count.verifications === 0) blockers.push('Aucune vérification enregistrée par un agent.')
  if (blocked(t.agent.status)) blockers.push('Le compte de l’agent qui suit ce talent est suspendu.')
  if (blocked(t.accountProfile?.user.status)) blockers.push('Le compte de suivi du talent est suspendu.')
  const granted = t.publicConsentAt !== null
  const visible = (await prisma.talentProfile.count({ where: { ...PUBLIC_TALENT_WHERE, id: talentId } })) > 0
  return {
    granted,
    publicConsentAt: t.publicConsentAt?.toISOString() ?? null,
    publicRef: visible ? t.publicRef : null,
    /** La fiche est en ligne (recommandée, ou accord public et conditions réunies). */
    visible,
    /** Conditions manquantes pour publier par accord. */
    blockers,
  }
}
