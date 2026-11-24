import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, MapPin, MessageSquareLock, SearchX, Sparkles, UsersRound } from 'lucide-react'
import { FadeUp } from '../../components/motion/Motion'
import { PublicEndorsementList } from '../../components/trust/PublicEndorsementList'
import { TrustLevelBadge } from '../../components/trust/TrustLevelBadge'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { Field, Textarea } from '../../components/ui/Form'
import { Loading } from '../../components/ui/Loading'
import { ReportButton } from '../../components/ui/ReportButton'
import { useApp } from '../../context/AppContext'
import { SECTOR_LABELS } from '../../data/constants'
import { TRUST_LEVEL_LABELS } from '../../data/endorsements'
import { ApiError, apiPublicTalent, apiRequestTalentContact, apiTalentAccountMe } from '../../lib/api'
import type { PublicTalentDetail as PublicTalentDetailData } from '../../types'
import { SECTOR_ICONS, VerificationBadge, countsLabel, publicName, publicPlace } from './PublicTalentCard'
import { CONTACT_REQUESTER_ROLES } from './PublicTalents'
import './PublicTalents.css'

const LEVEL_EXPLANATIONS = {
  nouveau: 'Réputation en construction : elle grandit avec chaque recommandation de personnes différentes.',
  recommande: 'Recommandé par au moins deux personnes différentes qui l’ont vu travailler.',
  tres_recommande:
    'Recommandé par au moins quatre personnes différentes, dont au moins une avec une preuve vérifiée par un agent, pour un travail récent.',
} as const

/**
 * Fiche publique d'un talent (`/annuaire/talents/:ref`, ancienne adresse
 * `/talents/:ref` redirigée) : mêmes champs que la carte de la vitrine
 * (liste blanche), les recommandations publiées avec auteur anonyme
 * (décision 2026-11-16), et une demande de contact passant par OffRec pour
 * un membre connecté.
 */
export function PublicTalentDetail() {
  const { ref = '' } = useParams()
  const { currentUser } = useApp()
  const [talent, setTalent] = useState<PublicTalentDetailData | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'missing' | 'error'>('loading')
  const [need, setNeed] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState('')
  const [formError, setFormError] = useState('')
  // Compte de suivi d'un talent sur SA propre fiche : pas de formulaire.
  const [ownRef, setOwnRef] = useState<string | null>(null)

  useEffect(() => {
    if (currentUser?.role !== 'talent') return
    apiTalentAccountMe()
      .then((a) => setOwnRef(a.talent?.publicVisibility.publicRef ?? null))
      .catch(() => setOwnRef(null))
  }, [currentUser?.role])

  const load = () => {
    setState('loading')
    apiPublicTalent(ref)
      .then((t) => {
        setTalent(t)
        setState('ok')
      })
      .catch((err) => setState(err instanceof ApiError && err.status === 404 ? 'missing' : 'error'))
  }

  useEffect(load, [ref])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setFormError('')
    setSending(true)
    try {
      const res = await apiRequestTalentContact(ref, need.trim())
      setSent(res.message)
      setNeed('')
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Envoi impossible.')
    } finally {
      setSending(false)
    }
  }

  if (state === 'loading') {
    return (
      <div className="page dir-page">
        <div className="container">
          <Loading />
        </div>
      </div>
    )
  }

  if (state !== 'ok' || !talent) {
    return (
      <div className="page dir-page">
        <div className="container ptl-page">
          <Link to="/annuaire/talents" className="ptl-back">
            <ArrowLeft size={16} aria-hidden /> Tous les talents recommandés
          </Link>
          {state === 'missing' ? (
            <EmptyState
              icon={SearchX}
              title="Ce talent n’est pas (ou plus) présenté publiquement"
              description="La fiche a pu être retirée, ou le lien n’est plus valable. Découvrez les autres talents recommandés."
            />
          ) : (
            <Card>
              <p className="ptl-error">Impossible de charger cette fiche pour le moment.</p>
              <Button size="sm" onClick={load}>
                Réessayer
              </Button>
            </Card>
          )}
        </div>
      </div>
    )
  }

  const Icon = SECTOR_ICONS[talent.sector] ?? Sparkles
  const canRequest = currentUser ? CONTACT_REQUESTER_ROLES.includes(currentUser.role) : false

  return (
    <div className="page dir-page">
      <div className="container ptl-page ptl-detail">
        <Link to="/annuaire/talents" className="ptl-back">
          <ArrowLeft size={16} aria-hidden /> Tous les talents recommandés
        </Link>

        <div className="ptl-detail-grid">
          <div className="ptl-detail-main">
            <FadeUp eager>
              <Card className={`ptl-detail-hero ptl-card-${talent.level}`}>
                <div className="ptl-card-head">
                  <span className="ptl-card-icon ptl-card-icon-lg" aria-hidden>
                    <Icon size={26} strokeWidth={1.75} />
                  </span>
                  <div className="ptl-card-title">
                    <h1>{publicName(talent)}</h1>
                    <p className="ptl-card-sector">
                      {talent.trade} · {SECTOR_LABELS[talent.sector]}
                    </p>
                  </div>
                </div>
                <p className="ptl-card-place">
                  <MapPin size={15} aria-hidden />
                  {publicPlace(talent)}
                </p>
                <div className="ptl-card-trust">
                  <TrustLevelBadge level={talent.level} />
                  <span className="ptl-card-sources">
                    <UsersRound size={15} aria-hidden />
                    {countsLabel(talent)}
                  </span>
                </div>
                <p className="ptl-level-note">
                  <strong>{TRUST_LEVEL_LABELS[talent.level]} :</strong> {LEVEL_EXPLANATIONS[talent.level]}
                </p>
                <p>
                  <VerificationBadge talent={talent} large />
                </p>
              </Card>
            </FadeUp>

            <Card className="ptl-block">
              <h2>Points forts cités</h2>
              {talent.highlights.length > 0 ? (
                <ul className="ptl-chips ptl-chips-lg">
                  {talent.highlights.map((h) => (
                    <li key={h} className="ptl-chip">
                      {h}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ptl-muted">Les points forts apparaîtront avec les premières recommandations.</p>
              )}
            </Card>

            <Card className="ptl-block">
              <h2>Recommandations</h2>
              <PublicEndorsementList
                items={talent.recommendations}
                emptyText="Aucune recommandation publiée pour l’instant."
              />
            </Card>

            <Card className="ptl-block">
              <h2>Comment OffRec présente cette fiche</h2>
              <ul className="ptl-steps">
                <li>
                  <CheckCircle2 size={16} aria-hidden />
                  Des clients, employeurs ou collègues ont recommandé cette personne après l’avoir vue travailler.
                </li>
                <li>
                  <CheckCircle2 size={16} aria-hidden />
                  {talent.verified
                    ? 'Un agent OffRec l’a rencontrée et a vérifié son savoir-faire avec la grille de son métier.'
                    : 'Aucun agent OffRec ne l’a encore rencontrée : le badge « Non encore vérifié » le signale.'}
                </li>
                <li>
                  <CheckCircle2 size={16} aria-hidden />
                  Les auteurs des recommandations restent anonymes et leurs preuves ne sont jamais publiées.
                </li>
                <li>
                  <CheckCircle2 size={16} aria-hidden />
                  Ses coordonnées ne sont jamais publiées : OffRec organise le contact.
                </li>
              </ul>
            </Card>
          </div>

          <aside className="ptl-detail-side">
            <Card className="ptl-contact">
              <h2>
                <MessageSquareLock size={18} aria-hidden /> Demander un contact
              </h2>
              {!currentUser ? (
                <>
                  <p className="ptl-muted">
                    Connectez-vous et décrivez votre besoin : un agent OffRec vous recontacte pour organiser la
                    rencontre.
                  </p>
                  <div className="ptl-contact-actions">
                    <Link to="/connexion" state={{ from: { pathname: `/annuaire/talents/${talent.publicRef}` } }}>
                      <Button fullWidth>Se connecter pour demander un contact</Button>
                    </Link>
                    <Link to="/inscription" className="ptl-link">
                      Pas encore de compte ? Inscrivez-vous
                    </Link>
                  </div>
                </>
              ) : ownRef === talent.publicRef ? (
                <p className="ptl-muted">
                  C’est votre fiche publique. Les demandes de contact reçues sont traitées par votre agent OffRec, qui
                  vous appelle.
                </p>
              ) : !canRequest ? (
                <p className="ptl-muted">
                  Les demandes de contact sont réservées aux particuliers, candidats, recruteurs et talents. Les agents
                  et administrateurs passent par leurs outils habituels.
                </p>
              ) : sent ? (
                <div className="ptl-sent" role="status">
                  <CheckCircle2 size={20} aria-hidden />
                  <p>{sent}</p>
                  <Link to="/annuaire/talents#mes-demandes" className="ptl-link">
                    Suivre mes demandes
                  </Link>
                </div>
              ) : (
                <form onSubmit={submit} className="ptl-contact-form">
                  <Field
                    label="Votre besoin"
                    hint="Travail à faire, lieu, délai… (20 caractères au moins). Ne donnez pas de données sensibles."
                  >
                    <Textarea
                      value={need}
                      onChange={(e) => setNeed(e.target.value)}
                      rows={5}
                      maxLength={1000}
                      required
                      minLength={20}
                      placeholder="Ex. : je cherche quelqu’un pour refaire l’installation électrique d’une cuisine à Ambohipo, d’ici deux semaines."
                    />
                  </Field>
                  {formError && (
                    <p className="ptl-form-error" role="alert">
                      {formError}
                    </p>
                  )}
                  <Button type="submit" fullWidth disabled={sending || need.trim().length < 20}>
                    {sending ? 'Envoi…' : 'Envoyer ma demande à OffRec'}
                  </Button>
                  <p className="ptl-fineprint">
                    Votre demande est lue par un agent OffRec, jamais publiée. Le talent n’est pas contacté
                    directement par la plateforme.
                  </p>
                </form>
              )}
            </Card>
            {currentUser && (
              <div className="ptl-report">
                <ReportButton targetType="talent" targetId={talent.publicRef} />
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}
