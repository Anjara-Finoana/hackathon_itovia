import { Link } from 'react-router-dom'
import { ArrowRight, ChefHat, CircleDashed, Hammer, Laptop, MapPin, Scissors, ShieldCheck, Sparkles, Store, UsersRound } from 'lucide-react'
import { TrustLevelBadge } from '../../components/trust/TrustLevelBadge'
import { SECTOR_LABELS } from '../../data/constants'
import { formatMonth } from '../../lib/format'
import type { PublicTalent, Sector } from '../../types'

export const SECTOR_ICONS: Record<Sector, typeof Hammer> = {
  btp: Hammer,
  textile_artisanat: Scissors,
  digital: Laptop,
  agroalimentaire: ChefHat,
  services_commerce: Store,
  autre: Sparkles,
}

/** « Ambanidia, Antananarivo » ou la ville seule. */
export function publicPlace(t: Pick<PublicTalent, 'district' | 'city'>): string {
  return t.district ? `${t.district}, ${t.city}` : t.city
}

/** « septembre 2026 » à partir de `AAAA-MM`. */
export function verifiedMonthLabel(month: string | null): string | null {
  return month ? formatMonth(`${month}-15T12:00:00Z`) : null
}

export function sourcesLabel(n: number): string {
  if (n === 0) return 'Pas encore de recommandation retenue'
  return n > 1 ? `${n} personnes différentes l’ont recommandé·e` : '1 personne l’a recommandé·e'
}

/** « 3 recommandations · 2 sources indépendantes ». */
export function countsLabel(t: Pick<PublicTalent, 'recommendationCount' | 'independentSources'>): string {
  if (t.recommendationCount === 0) return 'Pas encore de recommandation retenue'
  const recos = `${t.recommendationCount} recommandation${t.recommendationCount > 1 ? 's' : ''}`
  const sources = `${t.independentSources} source${t.independentSources > 1 ? 's' : ''} indépendante${t.independentSources > 1 ? 's' : ''}`
  return `${recos} · ${sources}`
}

/** Nom publié, ou « Talent recommandé » s'il est inconnu ou purgé. */
export function publicName(t: Pick<PublicTalent, 'name'>): string {
  return t.name ?? 'Talent recommandé'
}

/** Badge « Vérifié par OffRec » (profil avec vérification) ou « Non encore vérifié ». */
export function VerificationBadge({ talent, large }: { talent: PublicTalent; large?: boolean }) {
  const month = verifiedMonthLabel(talent.verifiedMonth)
  if (talent.verified) {
    return (
      <span className={`ptl-verified${large ? ' ptl-verified-lg' : ''}`}>
        <ShieldCheck size={large ? 16 : 14} aria-hidden />
        Vérifié par OffRec{month ? ` · ${month}` : ''}
      </span>
    )
  }
  return (
    <span className={`ptl-unverified${large ? ' ptl-verified-lg' : ''}`}>
      <CircleDashed size={large ? 16 : 14} aria-hidden />
      Non encore vérifié
    </span>
  )
}

/**
 * Carte de la vitrine : uniquement les champs de la liste blanche publique
 * (nom, métier, secteur, lieu, niveau, recommandations et sources, points
 * forts, vérification) — jamais de téléphone, de photo ni de contact.
 */
export function PublicTalentCard({ talent, preview }: { talent: PublicTalent; preview?: boolean }) {
  const Icon = SECTOR_ICONS[talent.sector] ?? Sparkles
  const body = (
    <>
      <div className="ptl-card-head">
        <span className="ptl-card-icon" aria-hidden>
          <Icon size={20} strokeWidth={1.75} />
        </span>
        <div className="ptl-card-title">
          <h3>{publicName(talent)}</h3>
          <p className="ptl-card-sector">
            {talent.trade} · {SECTOR_LABELS[talent.sector]}
          </p>
        </div>
      </div>
      <p className="ptl-card-place">
        <MapPin size={14} aria-hidden />
        {publicPlace(talent)}
      </p>
      <div className="ptl-card-trust">
        <TrustLevelBadge level={talent.level} />
        <span className="ptl-card-sources">
          <UsersRound size={14} aria-hidden />
          {countsLabel(talent)}
        </span>
      </div>
      {talent.highlights.length > 0 && (
        <ul className="ptl-chips" aria-label="Points forts cités">
          {talent.highlights.map((h) => (
            <li key={h} className="ptl-chip">
              {h}
            </li>
          ))}
        </ul>
      )}
      <div className="ptl-card-foot">
        <VerificationBadge talent={talent} />
        {!preview && (
          <span className="ptl-card-more">
            Voir la fiche <ArrowRight size={14} aria-hidden />
          </span>
        )}
      </div>
    </>
  )
  // Aperçu (fiche agent) : même rendu, sans lien.
  if (preview) return <div className={`ptl-card ptl-card-${talent.level}`}>{body}</div>
  return (
    <Link to={`/annuaire/talents/${talent.publicRef}`} className={`ptl-card ptl-card-${talent.level}`}>
      {body}
    </Link>
  )
}
