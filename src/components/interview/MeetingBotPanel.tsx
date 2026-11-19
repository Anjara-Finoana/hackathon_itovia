import { useState, useEffect, useRef } from 'react'
import { Bot, Play, Square, CheckSquare, Sparkles, AlertCircle, Radio, ShieldCheck, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '../ui/Button'
import './MeetingBotPanel.css'

interface TranscriptItem {
  id?: string
  speakerName: string
  speakerRole: string
  startTime: number
  endTime: number
  text: string
}

interface ActionItem {
  id: string
  title: string
  assigneeRole: string
  priority: string
  status: string
}

interface MeetingNote {
  id: string
  summary: string
  keyTakeaways: string[]
  candidateStrengths: string[]
  candidateWeaknesses: string[]
  technicalAssessment?: string
  softSkillsAssessment?: string
  culturalFitScore?: number
  technicalFitScore?: number
  recommendation?: 'retenu' | 'second_entretien' | 'non_retenu' | 'absent'
  recommendedReason?: string
}

interface MeetingBotData {
  id: string
  status: string
  failureReason?: string
}

interface MeetingData {
  id: string
  meetUrl: string
  status: string
  recruiterConsent: boolean
  candidateConsent: boolean
  bots: MeetingBotData[]
  notes: MeetingNote[]
  actionItems: ActionItem[]
}

interface MeetingBotPanelProps {
  interviewId: string
  meetUrl?: string | null
  onApplyOutcome?: (outcome: string, reason?: string, note?: string) => void
}

export function MeetingBotPanel({ interviewId, meetUrl, onApplyOutcome }: MeetingBotPanelProps) {
  const [meeting, setMeeting] = useState<MeetingData | null>(null)
  const [customMeetUrl, setCustomMeetUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([])
  const [showLiveTranscript, setShowLiveTranscript] = useState(false)
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Initialisation de la réunion
  useEffect(() => {
    let isMounted = true
    async function init() {
      try {
        setLoading(true)
        const res = await fetch('/api/meetings/init-from-interview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ interviewId }),
        })
        if (!res.ok) throw new Error('Impossible d initialiser la session visio')
        const data = await res.json()
        if (isMounted && data.meeting) {
          setMeeting(data.meeting)
          setCustomMeetUrl(data.meeting.meetUrl || meetUrl || '')
        }
      } catch (err) {
        if (isMounted) setError((err as Error).message)
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    init()
    return () => {
      isMounted = false
    }
  }, [interviewId])

  // Polling du direct quand le bot est en cours
  const activeBot = meeting?.bots?.[0]
  const isBotActive =
    activeBot && ['connexion', 'salle_attente', 'en_appel', 'enregistrement'].includes(activeBot.status)

  useEffect(() => {
    if (!meeting || !isBotActive) {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
      return
    }

    async function pollLive() {
      try {
        const res = await fetch(`/api/meetings/${meeting?.id}/live`)
        if (!res.ok) return
        const data = await res.json()
        if (data.transcripts) {
          setTranscripts(data.transcripts)
        }
        if (data.bot) {
          setMeeting((prev) => (prev ? { ...prev, bots: [data.bot] } : null))
        }
        if (data.note) {
          setMeeting((prev) => (prev ? { ...prev, notes: [data.note] } : null))
        }
      } catch {
        // Ignorer les erreurs ponctuelles de polling
      }
    }

    pollTimerRef.current = setInterval(pollLive, 3500)
    pollLive()

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    }
  }, [meeting?.id, isBotActive])

  // Gestion du consentement
  async function handleToggleConsent() {
    if (!meeting || busy) return
    const nextConsent = !meeting.recruiterConsent
    try {
      setBusy(true)
      const res = await fetch(`/api/meetings/${meeting.id}/consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isRecruiter: true, consent: nextConsent }),
      })
      if (!res.ok) throw new Error('Erreur enregistrement consentement')
      const data = await res.json()
      setMeeting(data.meeting)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // Déployer le bot
  async function handleLaunchBot() {
    if (!meeting || busy) return
    try {
      setBusy(true)
      setError('')
      const res = await fetch(`/api/meetings/${meeting.id}/bot/launch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetUrl: customMeetUrl || meeting.meetUrl }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur lors du lancement du bot')
      setMeeting((prev) =>
        prev
          ? {
              ...prev,
              bots: [{ id: data.botId, status: data.status }],
            }
          : null,
      )
      setShowLiveTranscript(true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // Déconnecter le bot
  async function handleLeaveBot() {
    if (!meeting || busy) return
    try {
      setBusy(true)
      const res = await fetch(`/api/meetings/${meeting.id}/bot/leave`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error('Erreur déconnexion')
      setMeeting((prev) =>
        prev
          ? {
              ...prev,
              status: 'termine',
              bots: [{ ...prev.bots[0], status: 'termine' }],
            }
          : null,
      )
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // Déclencher manuellement la synthèse
  async function handleGenerateNotes() {
    if (!meeting || busy) return
    try {
      setBusy(true)
      const res = await fetch(`/api/meetings/${meeting.id}/notes/generate`, {
        method: 'POST',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur synthèse IA')
      if (data.note) {
        setMeeting((prev) => (prev ? { ...prev, notes: [data.note] } : null))
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <div className="mbp-loading">Chargement de l assistant de visioconférence...</div>
  }

  const note = meeting?.notes?.[0]
  const hasTranscripts = transcripts.length > 0

  return (
    <div className="mbp-container">
      <div className="mbp-header">
        <div className="mbp-title-group">
          <Bot className="mbp-icon" size={20} />
          <div>
            <h4 className="mbp-title">Finoana Scribe — Assistant Visioconférence</h4>
            <p className="mbp-subtitle">Prise de notes autonome, transcription diarizée et synthèse Gemini</p>
          </div>
        </div>

        {activeBot && (
          <div className={`mbp-badge is-${activeBot.status}`}>
            {isBotActive && <Radio className="mbp-pulse" size={14} />}
            <span>{formatBotStatus(activeBot.status)}</span>
          </div>
        )}
      </div>

      {error && (
        <div className="mbp-alert">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* Barre d'action et consentement légal */}
      <div className="mbp-controls">
        <label className="mbp-consent-label">
          <input
            type="checkbox"
            checked={Boolean(meeting?.recruiterConsent)}
            onChange={handleToggleConsent}
            disabled={busy || isBotActive}
          />
          <ShieldCheck size={16} className="mbp-shield-icon" />
          <span>
            J'autorise l'enregistrement et la transcription de cet entretien (Conforme Loi 2014-038 Madagascar).
          </span>
        </label>

        {/* Champ Lien de réunion éditable */}
        <div className="mbp-url-row">
          <label className="mbp-url-label">Lien de la visioconférence (Google Meet, etc.) :</label>
          <div className="mbp-url-input-wrap">
            <input
              type="url"
              value={customMeetUrl}
              onChange={(e) => setCustomMeetUrl(e.target.value)}
              placeholder="https://meet.google.com/xxx-yyyy-zzz"
              disabled={busy || isBotActive}
              className="mbp-url-input"
            />
            {customMeetUrl && (
              <a
                href={customMeetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mbp-url-link"
              >
                Ouvrir l'appel ↗
              </a>
            )}
          </div>
        </div>

        <div className="mbp-buttons">
          {!isBotActive ? (
            <Button
              size="sm"
              variant="primary"
              disabled={busy || !meeting?.recruiterConsent || !customMeetUrl}
              onClick={handleLaunchBot}
            >
              <Play size={14} />
              Faire entrer le bot
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled={busy} onClick={handleLeaveBot}>
              <Square size={14} />
              Faire quitter le bot
            </Button>
          )}

          {hasTranscripts && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowLiveTranscript(!showLiveTranscript)}
            >
              {showLiveTranscript ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {transcripts.length} réplique{transcripts.length > 1 ? 's' : ''}
            </Button>
          )}

          {!note && hasTranscripts && !isBotActive && (
            <Button size="sm" variant="primary" disabled={busy} onClick={handleGenerateNotes}>
              <Sparkles size={14} />
              Générer la synthèse
            </Button>
          )}
        </div>
      </div>

      {/* Vue live des transcripts */}
      {showLiveTranscript && hasTranscripts && (
        <div className="mbp-transcript-box">
          <h5 className="mbp-transcript-title">Transcription en direct :</h5>
          <div className="mbp-transcript-feed">
            {transcripts.map((t, idx) => (
              <div key={t.id || idx} className={`mbp-transcript-item is-${t.speakerRole}`}>
                <span className="mbp-transcript-speaker">
                  {t.speakerName} ({t.speakerRole}) · {formatTime(t.startTime)}
                </span>
                <p className="mbp-transcript-text">{t.text}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Compte-rendu d'évaluation généré */}
      {note && (
        <div className="mbp-note-card">
          <div className="mbp-note-header">
            <div className="mbp-note-title">
              <Sparkles size={16} className="mbp-sparkle" />
              <span>Synthèse de l'entretien (Gemini 1.5 Flash)</span>
            </div>
            {note.recommendation && (
              <span className={`mbp-rec-tag is-${note.recommendation}`}>
                Recommandation : {formatRecommendation(note.recommendation)}
              </span>
            )}
          </div>

          <p className="mbp-note-summary">{note.summary}</p>

          <div className="mbp-grid-2">
            <div className="mbp-subcard">
              <h6>Points forts démontrés :</h6>
              <ul>
                {note.candidateStrengths?.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
            <div className="mbp-subcard">
              <h6>Points de vigilance :</h6>
              <ul>
                {note.candidateWeaknesses?.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          </div>

          {note.culturalFitScore !== undefined && (
            <div className="mbp-scores">
              <div className="mbp-score-item">
                <span>Adéquation Technique :</span>
                <strong>{note.technicalFitScore ?? 0}%</strong>
              </div>
              <div className="mbp-score-item">
                <span>Adéquation Culturelle :</span>
                <strong>{note.culturalFitScore ?? 0}%</strong>
              </div>
            </div>
          )}

          {/* Bouton d'application automatique */}
          {onApplyOutcome && note.recommendation && (
            <div className="mbp-apply-action">
              <Button
                size="sm"
                variant="primary"
                onClick={() =>
                  onApplyOutcome(note.recommendation!, note.recommendedReason, note.summary)
                }
              >
                <CheckSquare size={14} />
                Appliquer à l'issue de l'entretien
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function formatBotStatus(status: string): string {
  switch (status) {
    case 'connexion':
      return 'Connexion en cours...'
    case 'salle_attente':
      return 'En attente d admission'
    case 'en_appel':
      return 'En réunion'
    case 'enregistrement':
      return 'Enregistrement & Transcription'
    case 'deconnexion':
      return 'Déconnexion...'
    case 'termine':
      return 'Terminé'
    case 'erreur':
      return 'Erreur de connexion'
    default:
      return status
  }
}

function formatRecommendation(rec: string): string {
  switch (rec) {
    case 'retenu':
      return 'Retenu'
    case 'second_entretien':
      return 'Second entretien proposé'
    case 'non_retenu':
      return 'Non retenu'
    case 'absent':
      return 'Absent'
    default:
      return rec
  }
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}
