/**
 * Fiche CV structurée transmise au recruteur (décision produit 2026-11-18).
 *
 * Module PUR (aucune base, aucun serveur) : construit la réponse de
 * `GET /match-suggestions/:id/cv` par LISTE BLANCHE explicite à partir des
 * colonnes du profil candidat. Jamais le PDF original ni son chemin, jamais
 * l'email, le téléphone, l'adresse ou un lien (`cvExtractedInfo` n'est
 * jamais lu), jamais les drapeaux, le statut détaillé ou la note de
 * vérification (seul le booléen « vérifié par OffRec » sort), jamais le
 * score, le rang ni les raisons du matching, jamais les compétences
 * suggérées non confirmées (`cvSkillsSuggested`).
 *
 * Données confirmées du profil d'abord ; les données extraites du CV ne
 * sortent que si une extraction existe (et pas pour un CV rejeté par la
 * vérification humaine), chaque texte libre étant filtré par
 * `maskContactDetails()` puis recontrôlé par `hasContactDetails()`.
 * Vérifié par `scripts/hiring-examples.ts`.
 */
import type {
  Availability,
  EducationLevel,
  ExperienceLevel,
  OpportunityType,
  RecruiterCvEducation,
  RecruiterCvExperience,
  RecruiterCvSheet,
  Sector,
} from '../../../src/types/index.js'
import { contactDetailsError } from '../../../src/lib/interview.js'

export const CV_MASK = '[coordonnée masquée]'

/** Plafonds d'affichage : une fiche reste lisible, et bornée. */
const MAX_ITEMS = 15
const MAX_TEXT = 1200
const MAX_SHORT = 160

const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]{2,}/g
const URL_RE =
  /\b(?:https?:\/\/|www\.)\S+|\b(?:linkedin|github|gitlab|facebook|fb|twitter|instagram|behance|dribbble|wa|t)\.(?:com|me)\b\S*|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|mg|org|net|io|fr|dev|me|co|app|info|biz)\/\S*/gi
/** Même seuil que `contactDetailsError()` : 8 chiffres ou plus, séparateurs compris. */
const PHONE_RE = /(?:\+?\d[\s.\-()]*){8,}/g
/** Une période « 2018 - 2022 » (deux années) n'est pas un numéro. */
const YEAR_RANGE_RE = /^\s*(?:19|20)\d{2}\s*[-–]\s*(?:19|20)\d{2}[\s.\-()]*$/
const MASKED_RE = /\[coordonnée masquée\]/g

/** Remplace emails, liens et numéros de téléphone par `CV_MASK`. */
export function maskContactDetails(text: string): { text: string; masked: boolean } {
  let masked = false
  const flag = () => {
    masked = true
    return CV_MASK
  }
  let out = text.replace(EMAIL_RE, flag).replace(URL_RE, flag)
  out = out.replace(PHONE_RE, (match) => {
    if (YEAR_RANGE_RE.test(match)) return match
    // Garde la ponctuation / l'espace final éventuel avalé par le motif.
    return flag() + (/[\s.]+$/.exec(match)?.[0] ?? '')
  })
  return { text: out, masked }
}

/**
 * Le texte porte-t-il encore une coordonnée ? `contactDetailsError()`
 * (src/lib/interview.ts) plus les liens, les périodes « AAAA - AAAA » et le
 * masque lui-même étant neutralisés avant le contrôle.
 */
export function hasContactDetails(text: string): boolean {
  const neutral = text
    .replace(MASKED_RE, ' ')
    .replace(/\b(?:19|20)\d{2}\s*[-–]\s*(?:19|20)\d{2}\b/g, ' ')
  if (contactDetailsError(neutral)) return true
  URL_RE.lastIndex = 0
  const hasUrl = URL_RE.test(neutral)
  URL_RE.lastIndex = 0
  return hasUrl
}

/** Colonnes du profil candidat lues par la fiche (sous-ensemble de Prisma). */
export interface RecruiterCvSource {
  fullName: string
  province: string | null
  city: string | null
  educationLevel: EducationLevel | null
  experienceLevel: ExperienceLevel | null
  skills: string[]
  desiredOpportunityTypes: OpportunityType[]
  availability: Availability | null
  sector: Sector | null
  cvVerificationStatus: string | null
  cvProfessionalTitle: string | null
  cvProfessionalSummary: string | null
  cvExperiences: unknown
  cvEducation: unknown
  cvCertifications: unknown
  cvProjects: unknown
  cvLanguages: unknown
  cvTechnologies: string[]
  cvYearsOfExperience: number | null
  cvAvailability: string | null
  cvExtractionDate: Date | string | null
}

/** Nettoie un texte libre : coupe, masque, et l'abandonne s'il reste douteux. */
function cleaner(state: { masked: boolean }) {
  return (value: unknown, max = MAX_SHORT): string | null => {
    if (typeof value !== 'string') return null
    const trimmed = value.replace(/\s+/g, ' ').trim()
    if (!trimmed) return null
    const result = maskContactDetails(trimmed)
    if (result.masked) state.masked = true
    if (hasContactDetails(result.text)) {
      state.masked = true
      return null
    }
    return result.text.length > max ? `${result.text.slice(0, max - 1)}…` : result.text
  }
}

/** « AAAA » ou « AAAA-MM » : jamais un jour précis. */
function monthOf(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const m = /^((?:19|20)\d{2})(?:-(\d{2}))?/.exec(value.trim())
  if (!m) return null
  return m[2] ? `${m[1]}-${m[2]}` : m[1]
}

function records(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
    .slice(0, MAX_ITEMS)
}

function stringList(value: unknown, clean: (v: unknown) => string | null): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of value) {
    const text = clean(item)
    if (!text || text.includes(CV_MASK)) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(text)
    if (out.length >= 30) break
  }
  return out
}

export function buildRecruiterCvSheet(input: {
  suggestionId: string
  opportunity: { id: string; title: string }
  profile: RecruiterCvSource
}): RecruiterCvSheet {
  const p = input.profile
  const state = { masked: false }
  const clean = cleaner(state)
  const rejected = p.cvVerificationStatus === 'rejete'

  const experiences: RecruiterCvExperience[] = records(p.cvExperiences).flatMap((e) => {
    const jobTitle = clean(e.jobTitle)
    if (!jobTitle) return []
    return [
      {
        jobTitle,
        company: clean(e.company),
        location: clean(e.location),
        start: monthOf(e.startDate),
        end: monthOf(e.endDate),
        isCurrent: e.isCurrent === true,
        description: clean(e.description, MAX_TEXT),
        technologies: stringList(e.technologies, clean),
      },
    ]
  })
  const education: RecruiterCvEducation[] = records(p.cvEducation).flatMap((e) => {
    const degree = clean(e.degree)
    if (!degree) return []
    return [
      {
        degree,
        school: clean(e.school),
        field: clean(e.field),
        graduation: monthOf(e.graduationDate),
        description: clean(e.description, MAX_TEXT),
      },
    ]
  })
  // Jamais `credentialUrl` ni l'`url` d'un projet.
  const certifications = records(p.cvCertifications).flatMap((c) => {
    const name = clean(c.name)
    return name ? [{ name, issuer: clean(c.issuer), year: monthOf(c.issueDate)?.slice(0, 4) ?? null }] : []
  })
  const projects = records(p.cvProjects).flatMap((c) => {
    const name = clean(c.name)
    return name
      ? [{ name, role: clean(c.role), description: clean(c.description, MAX_TEXT), technologies: stringList(c.technologies, clean) }]
      : []
  })
  const languages = records(p.cvLanguages).flatMap((l) => {
    const name = clean(l.name, 60)
    return name ? [{ name, level: clean(l.level, 20) }] : []
  })
  const technologies = stringList(p.cvTechnologies, clean)
  const professionalTitle = clean(p.cvProfessionalTitle)
  const summary = clean(p.cvProfessionalSummary, MAX_TEXT)
  const availability = clean(p.cvAvailability)
  const years =
    typeof p.cvYearsOfExperience === 'number' && Number.isFinite(p.cvYearsOfExperience) && p.cvYearsOfExperience >= 0
      ? Math.min(Math.round(p.cvYearsOfExperience), 60)
      : null

  const hasExtraction =
    !rejected &&
    (!!p.cvExtractionDate ||
      experiences.length > 0 ||
      education.length > 0 ||
      !!professionalTitle ||
      !!summary)

  return {
    suggestionId: input.suggestionId,
    opportunity: { id: input.opportunity.id, title: input.opportunity.title },
    profile: {
      fullName: p.fullName,
      educationLevel: p.educationLevel ?? null,
      experienceLevel: p.experienceLevel ?? null,
      skills: [...(p.skills ?? [])],
      province: p.province ?? null,
      city: p.city ?? null,
      availability: p.availability ?? null,
      desiredOpportunityTypes: [...(p.desiredOpportunityTypes ?? [])],
      sector: p.sector ?? null,
    },
    cvVerified: p.cvVerificationStatus === 'verifie',
    extracted: hasExtraction
      ? {
          professionalTitle,
          summary,
          yearsOfExperience: years,
          availability,
          experiences,
          education,
          certifications,
          projects,
          languages,
          technologies,
          masked: state.masked,
        }
      : null,
  }
}
