import { EndorsementItem } from './EndorsementItem'
import { RELATION_LABELS } from '../../data/endorsements'
import { formatMonth } from '../../lib/format'
import type { EndorsementRelation, PublicEndorsement } from '../../types'
import './PublicEndorsementList.css'

/** Auteur toujours anonyme : seule la relation est dite. */
const ANONYMOUS_AUTHOR: Record<EndorsementRelation, string> = {
  client: 'Un client',
  employeur: 'Un employeur',
  collegue: 'Un collègue',
  salarie: 'Un ancien salarié',
  stagiaire: 'Un ancien stagiaire',
  prestataire: 'Un prestataire',
}

/**
 * Recommandations publiées sur une fiche publique (talent ou entreprise,
 * décision 2026-11-16) : relation, mois, points forts et commentaire. Le
 * serveur n'envoie jamais l'auteur ni la preuve ; un commentaire contenant
 * des coordonnées arrive masqué (`commentMasked`).
 */
export function PublicEndorsementList({ items, emptyText }: { items: PublicEndorsement[]; emptyText: string }) {
  if (items.length === 0) return <p className="pel-empty">{emptyText}</p>
  return (
    <div className="pel-list">
      {items.map((r, i) => (
        <EndorsementItem
          key={`${r.month}-${i}`}
          author={ANONYMOUS_AUTHOR[r.relation] ?? 'Une personne'}
          meta={`${RELATION_LABELS[r.relation] ?? 'Relation'} · ${formatMonth(`${r.month}-15T12:00:00Z`)}`}
          highlights={r.highlights}
        >
          {r.comment ? (
            <p className="pel-comment">« {r.comment} »</p>
          ) : r.commentMasked ? (
            <p className="pel-comment pel-comment-masked">Commentaire masqué : il contenait des coordonnées.</p>
          ) : null}
        </EndorsementItem>
      ))}
      <p className="pel-note">L’auteur de chaque recommandation reste anonyme ; les preuves ne sont jamais publiées.</p>
    </div>
  )
}
