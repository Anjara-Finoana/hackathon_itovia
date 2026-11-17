import { contactDetailsError } from '../../../src/lib/interview.js'
import type { EndorsementRelation, PublicEndorsement } from '../../../src/types/index.js'

/**
 * Recommandations publiées sur les fiches publiques des talents et des
 * entreprises (décision 2026-11-16). LISTE BLANCHE explicite : relation,
 * points forts, commentaire et mois. JAMAIS l'auteur (ni nom, ni pseudonyme,
 * ni id, ni empreinte), son quartier, le libellé du travail, la date exacte
 * ni la preuve (photo / PDF, qui reste privée).
 */

/** Mois `AAAA-MM` à Madagascar (UTC+3 fixe, comme le moteur de confiance). */
export function madagascarMonth(date: Date): string {
  return new Date(date.getTime() + 3 * 3600 * 1000).toISOString().slice(0, 7)
}

/** Ligne minimale lue pour publier une recommandation (déjà filtrée : non écartée, une par auteur). */
export interface PublishableEndorsement {
  relation: EndorsementRelation
  highlights: string[]
  comment: string | null
  createdAt: Date
}

/**
 * Vue publique d'une recommandation. Un commentaire portant une adresse
 * email ou un numéro de téléphone (anciennes saisies, avant le contrôle Zod)
 * est masqué en entier : `comment: null`, `commentMasked: true`.
 */
export function toPublicEndorsement(r: PublishableEndorsement): PublicEndorsement {
  const text = r.comment?.trim() || null
  const masked = text !== null && contactDetailsError(text) !== null
  return {
    relation: r.relation,
    highlights: [...r.highlights],
    comment: masked ? null : text,
    commentMasked: masked,
    month: madagascarMonth(r.createdAt),
  }
}
