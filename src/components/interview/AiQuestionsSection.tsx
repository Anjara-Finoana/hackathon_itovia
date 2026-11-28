import { useEffect, useState } from 'react'
import { HelpCircle, RefreshCw, Sparkles } from 'lucide-react'
import { Button } from '../ui/Button'
import {
  ApiError,
  apiGenerateInterviewQuestions,
  apiGetInterviewQuestions,
  type InterviewQuestionsResult,
  type RecommendedQuestionItem,
} from '../../lib/api'
import './AiQuestionsSection.css'

interface AiQuestionsSectionProps {
  suggestionId: string
  candidateName?: string
}

const CATEGORY_LABELS: Record<RecommendedQuestionItem['category'], string> = {
  technique: 'Technique',
  experience: 'Expérience CV',
  soft_skills: 'Soft skills',
  vigilance: 'Point à creuser',
}

export function AiQuestionsSection({ suggestionId, candidateName }: AiQuestionsSectionProps) {
  const [data, setData] = useState<InterviewQuestionsResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    apiGetInterviewQuestions(suggestionId)
      .then((res) => {
        if (active) setData(res.data ?? null)
      })
      .catch(() => {
        // Silencieux au chargement initial si aucune donnée
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [suggestionId])

  const handleGenerate = async () => {
    if (generating) return
    setGenerating(true)
    setError('')
    try {
      const res = await apiGenerateInterviewQuestions(suggestionId)
      setData(res.data)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de générer les questions pour le moment.')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <section className="aiq-box" aria-label="Questions recommandées par l'IA">
      <div className="aiq-head">
        <div className="aiq-title-wrap">
          <HelpCircle size={17} className="aiq-icon" aria-hidden />
          <div>
            <h4 className="aiq-title">Questions recommandées par l’IA</h4>
            <p className="aiq-sub">
              Suggestions ciblées selon l’offre et le CV{candidateName ? ` de ${candidateName}` : ''}.
            </p>
          </div>
        </div>
        <Button size="sm" variant={data ? 'outline' : 'primary'} disabled={generating || loading} onClick={handleGenerate}>
          {data ? <RefreshCw size={14} aria-hidden /> : <Sparkles size={14} aria-hidden />}
          {generating ? 'Génération…' : data ? 'Régénérer' : 'Recommander des questions IA'}
        </Button>
      </div>

      {error && (
        <p className="aiq-error" role="alert">
          {error}
        </p>
      )}

      {loading && <p className="aiq-muted">Chargement des recommandations…</p>}

      {!loading && !data && !error && (
        <p className="aiq-muted">
          Cliquez sur « Recommander des questions IA » pour obtenir une trame d’entretien adaptée au profil.
        </p>
      )}

      {data && (
        <div className="aiq-content">
          {data.focusPoints.length > 0 && (
            <div className="aiq-focus">
              <strong>Points clés à vérifier :</strong>
              <ul>
                {data.focusPoints.map((pt, idx) => (
                  <li key={idx}>{pt}</li>
                ))}
              </ul>
            </div>
          )}

          <ol className="aiq-list">
            {data.questions.map((item, idx) => (
              <li key={idx} className="aiq-item">
                <span className={`aiq-cat is-${item.category}`}>
                  {CATEGORY_LABELS[item.category] ?? item.category}
                </span>
                <p className="aiq-q">{item.question}</p>
                {item.intent && <p className="aiq-intent">{item.intent}</p>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  )
}
