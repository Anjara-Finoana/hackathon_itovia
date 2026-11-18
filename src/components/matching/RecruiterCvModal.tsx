import { useEffect, useState } from 'react'
import { EyeOff, ShieldCheck } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Loading } from '../ui/Loading'
import { apiRecruiterCvSheet } from '../../lib/api'
import {
  AVAILABILITY_LABELS,
  EDUCATION_LABELS,
  EXPERIENCE_LABELS,
  OPPORTUNITY_TYPE_LABELS,
  SECTOR_LABELS,
} from '../../data/constants'
import type { RecruiterCvSheet } from '../../types'
import './RecruiterCvModal.css'

interface RecruiterCvModalProps {
  suggestionId: string
  candidateName: string
  onClose: () => void
}

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

/** « AAAA » ou « AAAA-MM » → « 2021 » ou « mars 2021 ». */
function period(value: string | null): string | null {
  if (!value) return null
  const [year, month] = value.split('-')
  const m = month ? Number(month) : NaN
  return m >= 1 && m <= 12 ? `${MONTHS[m - 1]} ${year}` : year
}

function range(start: string | null, end: string | null, current: boolean): string | null {
  const from = period(start)
  const to = current ? 'aujourd’hui' : period(end)
  if (from && to) return `${from} – ${to}`
  return from ?? to
}

const join = (parts: Array<string | null | undefined | false>) => parts.filter(Boolean).join(' · ')

/**
 * « Voir le CV » (décision 2026-11-18) : fiche CV structurée générée par
 * OffRec pour un candidat proposé au recruteur — jamais le PDF original,
 * aucune coordonnée, aucun score. Ouverte depuis la page (jamais par-dessus
 * une autre Modal).
 */
export function RecruiterCvModal({ suggestionId, candidateName, onClose }: RecruiterCvModalProps) {
  const [sheet, setSheet] = useState<RecruiterCvSheet | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    setError(null)
    setSheet(null)
    apiRecruiterCvSheet(suggestionId)
      .then((s) => alive && setSheet(s))
      .catch((err: unknown) => alive && setError(err instanceof Error ? err.message : 'La fiche CV n’a pas pu être chargée.'))
    return () => {
      alive = false
    }
  }, [suggestionId, attempt])

  const p = sheet?.profile
  const x = sheet?.extracted

  return (
    <Modal title={`CV de ${candidateName}`} onClose={onClose}>
      <div className="rcv">
        <p className="rcv-privacy">
          <EyeOff size={14} aria-hidden />
          Coordonnées masquées : OffRec assure la mise en relation.
        </p>

        {!sheet && !error && <Loading label="Chargement de la fiche CV…" />}

        {error && (
          <div className="rcv-error" role="alert">
            <p>{error}</p>
            <Button size="sm" variant="outline" onClick={() => setAttempt((n) => n + 1)}>
              Réessayer
            </Button>
          </div>
        )}

        {sheet && p && (
          <>
            <header className="rcv-head">
              <strong className="rcv-name">{p.fullName}</strong>
              <span className="rcv-offer">Proposé pour : {sheet.opportunity.title}</span>
              {sheet.cvVerified && (
                <span className="rcv-verified">
                  <ShieldCheck size={14} aria-hidden />
                  CV vérifié par OffRec
                </span>
              )}
            </header>

            <section className="rcv-section" aria-labelledby="rcv-profile">
              <h3 id="rcv-profile">Profil confirmé par le candidat</h3>
              <dl className="rcv-facts">
                {p.educationLevel && (
                  <>
                    <dt>Niveau d’études</dt>
                    <dd>{EDUCATION_LABELS[p.educationLevel] ?? p.educationLevel}</dd>
                  </>
                )}
                {p.experienceLevel && (
                  <>
                    <dt>Expérience</dt>
                    <dd>{EXPERIENCE_LABELS[p.experienceLevel] ?? p.experienceLevel}</dd>
                  </>
                )}
                {(p.city || p.province) && (
                  <>
                    <dt>Localisation</dt>
                    <dd>{join([p.city, p.province])}</dd>
                  </>
                )}
                {p.availability && (
                  <>
                    <dt>Disponibilité</dt>
                    <dd>{AVAILABILITY_LABELS[p.availability] ?? p.availability}</dd>
                  </>
                )}
                {p.desiredOpportunityTypes.length > 0 && (
                  <>
                    <dt>Recherche</dt>
                    <dd>{p.desiredOpportunityTypes.map((t) => OPPORTUNITY_TYPE_LABELS[t] ?? t).join(', ')}</dd>
                  </>
                )}
                {p.sector && (
                  <>
                    <dt>Secteur</dt>
                    <dd>{SECTOR_LABELS[p.sector] ?? p.sector}</dd>
                  </>
                )}
              </dl>
              {p.skills.length > 0 && (
                <ul className="rcv-tags" aria-label="Compétences confirmées">
                  {p.skills.map((skill) => (
                    <li key={skill}>{skill}</li>
                  ))}
                </ul>
              )}
            </section>

            {x ? (
              <>
                <p className="rcv-source">
                  Les sections suivantes sont extraites du CV déposé par le candidat
                  {sheet.cvVerified ? ' et vérifié par OffRec' : ''}.
                  {x.masked && ' Certaines coordonnées présentes dans le CV ont été masquées.'}
                </p>

                {(x.professionalTitle || x.summary || x.yearsOfExperience !== null || x.availability) && (
                  <section className="rcv-section" aria-labelledby="rcv-summary">
                    <h3 id="rcv-summary">Résumé</h3>
                    {x.professionalTitle && <p className="rcv-title">{x.professionalTitle}</p>}
                    {x.summary && <p>{x.summary}</p>}
                    {(x.yearsOfExperience !== null || x.availability) && (
                      <p className="rcv-muted">
                        {join([
                          x.yearsOfExperience !== null &&
                            `${x.yearsOfExperience} an${x.yearsOfExperience > 1 ? 's' : ''} d’expérience`,
                          x.availability && `Disponibilité indiquée : ${x.availability}`,
                        ])}
                      </p>
                    )}
                  </section>
                )}

                {x.experiences.length > 0 && (
                  <section className="rcv-section" aria-labelledby="rcv-exp">
                    <h3 id="rcv-exp">Expériences</h3>
                    <ul className="rcv-items">
                      {x.experiences.map((e, i) => (
                        <li key={i}>
                          <strong>{e.jobTitle}</strong>
                          <span className="rcv-muted">
                            {join([e.company, e.location, range(e.start, e.end, e.isCurrent)])}
                          </span>
                          {e.description && <p>{e.description}</p>}
                          {e.technologies.length > 0 && <span className="rcv-muted">{e.technologies.join(', ')}</span>}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {x.education.length > 0 && (
                  <section className="rcv-section" aria-labelledby="rcv-edu">
                    <h3 id="rcv-edu">Formations</h3>
                    <ul className="rcv-items">
                      {x.education.map((e, i) => (
                        <li key={i}>
                          <strong>{join([e.degree, e.field])}</strong>
                          <span className="rcv-muted">{join([e.school, period(e.graduation)])}</span>
                          {e.description && <p>{e.description}</p>}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {x.certifications.length > 0 && (
                  <section className="rcv-section" aria-labelledby="rcv-cert">
                    <h3 id="rcv-cert">Certifications</h3>
                    <ul className="rcv-items">
                      {x.certifications.map((c, i) => (
                        <li key={i}>
                          <strong>{c.name}</strong>
                          <span className="rcv-muted">{join([c.issuer, c.year])}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {x.projects.length > 0 && (
                  <section className="rcv-section" aria-labelledby="rcv-proj">
                    <h3 id="rcv-proj">Projets</h3>
                    <ul className="rcv-items">
                      {x.projects.map((c, i) => (
                        <li key={i}>
                          <strong>{c.name}</strong>
                          {c.role && <span className="rcv-muted">{c.role}</span>}
                          {c.description && <p>{c.description}</p>}
                          {c.technologies.length > 0 && <span className="rcv-muted">{c.technologies.join(', ')}</span>}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {x.languages.length > 0 && (
                  <section className="rcv-section" aria-labelledby="rcv-lang">
                    <h3 id="rcv-lang">Langues</h3>
                    <ul className="rcv-tags">
                      {x.languages.map((l, i) => (
                        <li key={i}>{join([l.name, l.level])}</li>
                      ))}
                    </ul>
                  </section>
                )}

                {x.technologies.length > 0 && (
                  <section className="rcv-section" aria-labelledby="rcv-tech">
                    <h3 id="rcv-tech">Outils et technologies cités dans le CV</h3>
                    <ul className="rcv-tags">
                      {x.technologies.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            ) : (
              <p className="rcv-source">Aucune donnée extraite du CV n’est disponible : la fiche reprend le profil confirmé.</p>
            )}
          </>
        )}

        <div className="rcv-footer">
          <Button variant="outline" size="sm" onClick={onClose}>
            Fermer
          </Button>
        </div>
      </div>
    </Modal>
  )
}
