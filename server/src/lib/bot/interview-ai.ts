import { GoogleGenerativeAI } from '@google/generative-ai'
import { prisma } from '../prisma.js'
import { antigravityGenerateText, extractJsonFromMarkdown } from '../antigravity-client.js'
import { buildRecruiterCvSheet } from '../recruiter-cv.js'

const apiKey = process.env.GEMINI_API_KEY
const modelName = process.env.GEMINI_MODEL ?? 'gemini-1.5-flash'
const aiProvider = process.env.AI_PROVIDER ?? (process.env.ANTIGRAVITY_API_KEY ? 'antigravity_api' : 'gemini')
const geminiClient = apiKey ? new GoogleGenerativeAI(apiKey) : null

export interface RecommendedQuestionItem {
  category: 'technique' | 'experience' | 'soft_skills' | 'vigilance'
  question: string
  intent: string
}

export interface InterviewQuestionsResult {
  questions: RecommendedQuestionItem[]
  focusPoints: string[]
  generatedAt: string
}

export interface CandidateComparisonItem {
  suggestionId: string
  fullName: string
  rank: number
  technicalFitScore: number | null
  culturalFitScore: number | null
  recommendation: string | null
  explanation: string
}

export interface OpportunityAiDecisionResult {
  recommendedCandidate: {
    suggestionId: string
    fullName: string
    reason: string
  } | null
  ranking: CandidateComparisonItem[]
  pendingCandidates: string[]
  summary: string
  generatedAt: string
}

async function runStructuredAiJson<T>(prompt: string, fallback: () => T): Promise<T> {
  if (aiProvider === 'antigravity_api' && process.env.ANTIGRAVITY_API_KEY) {
    try {
      const rawText = await antigravityGenerateText({
        prompt: `${prompt}\nRéponds UNIQUEMENT avec le JSON demandé, sans texte autour.`,
        model: process.env.ANTIGRAVITY_API_MODEL,
        timeoutMs: 40000,
      })
      if (rawText) {
        return JSON.parse(extractJsonFromMarkdown(rawText)) as T
      }
    } catch (err) {
      console.error('[InterviewAI] Erreur Antigravity API:', err)
    }
  }

  if (geminiClient) {
    try {
      const model = geminiClient.getGenerativeModel({
        model: modelName,
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
      })
      const result = await model.generateContent(prompt)
      return JSON.parse(result.response.text()) as T
    } catch (err) {
      console.error('[InterviewAI] Erreur Gemini:', err)
    }
  }

  return fallback()
}

/**
 * Génère (et sauvegarde sur MatchSuggestion.aiInterviewQuestions) des questions
 * d'entretien personnalisées à partir de l'offre et du CV structuré du candidat.
 */
export async function generateInterviewQuestions(
  suggestionId: string,
  recruiterId: string,
): Promise<InterviewQuestionsResult> {
  const suggestion = await prisma.matchSuggestion.findUnique({
    where: { id: suggestionId },
    include: {
      opportunity: true,
      candidate: {
        include: { candidateProfile: true },
      },
    },
  })

  if (!suggestion || suggestion.opportunity.recruiterId !== recruiterId) {
    throw new Error('Dossier introuvable ou accès non autorisé.')
  }

  const profile = suggestion.candidate.candidateProfile
  if (!profile) {
    throw new Error('Profil candidat indisponible pour générer des questions.')
  }

  const opp = suggestion.opportunity
  const cv = buildRecruiterCvSheet({
    suggestionId: suggestion.id,
    opportunity: { id: opp.id, title: opp.title },
    profile,
  })

  const prompt = `
Tu es l'assistant RH d'OffRec (Madagascar). Prépare une liste de questions d'entretien pertinentes pour aider le recruteur à évaluer ce candidat par rapport à l'offre.

Offre d'emploi :
- Titre : ${opp.title}
- Niveau attendu : ${opp.level}
- Description : ${opp.description}
- Missions : ${opp.missions.join(' ; ') || 'Non précisées'}
- Compétences requises : ${opp.requiredSkills.join(', ') || 'Non précisées'}

CV structuré du candidat (${cv.profile.fullName}) :
- Expérience : ${cv.profile.experienceLevel ?? 'Non précisée'}
- Compétences : ${cv.profile.skills.join(', ') || 'Non renseignées'}
- Titre / Résumé CV : ${[cv.extracted?.professionalTitle, cv.extracted?.summary].filter(Boolean).join(' — ') || 'Non renseigné'}
- Expériences : ${(cv.extracted?.experiences ?? []).map((e) => `${e.jobTitle} (${e.company ?? 'entreprise'}, ${e.start ?? ''}${e.end ? `-${e.end}` : e.isCurrent ? '-actuel' : ''}) : ${e.description ?? ''} ${e.technologies.length ? `[${e.technologies.join(', ')}]` : ''}`).join(' | ') || 'Non renseignées'}
- Formations : ${(cv.extracted?.education ?? []).map((ed) => `${ed.degree}${ed.field ? ` (${ed.field})` : ''} - ${ed.school ?? ''}`).join(' | ') || 'Non renseignées'}
- Langues : ${(cv.extracted?.languages ?? []).join(', ') || 'Non renseignées'}

Retourne STRICTEMENT un JSON avec :
{
  "questions": [
    {
      "category": "technique" | "experience" | "soft_skills" | "vigilance",
      "question": "Question claire et directe en français à poser au candidat",
      "intent": "Ce que cette question permet de vérifier (1 phrase courte)"
    }
  ],
  "focusPoints": ["Point clé 1 à vérifier pendant l'entretien", "Point clé 2"]
}
Génère 5 à 6 questions variées (techniques, expérience concrète sur le CV, soft skills et 1 point de vigilance/écart éventuel avec l'offre).
`

  const parsed = await runStructuredAiJson<{
    questions?: RecommendedQuestionItem[]
    focusPoints?: string[]
  }>(prompt, () => buildFallbackQuestions(opp.title, opp.requiredSkills, cv.profile.skills, cv.profile.fullName))

  const result: InterviewQuestionsResult = {
    questions: Array.isArray(parsed.questions) && parsed.questions.length > 0
      ? parsed.questions.slice(0, 7)
      : buildFallbackQuestions(opp.title, opp.requiredSkills, cv.profile.skills, cv.profile.fullName).questions,
    focusPoints: Array.isArray(parsed.focusPoints) ? parsed.focusPoints.slice(0, 4) : [],
    generatedAt: new Date().toISOString(),
  }

  await prisma.matchSuggestion.update({
    where: { id: suggestion.id },
    data: { aiInterviewQuestions: result as unknown as object },
  })

  return result
}

function buildFallbackQuestions(
  offerTitle: string,
  requiredSkills: string[],
  candidateSkills: string[],
  fullName: string,
): { questions: RecommendedQuestionItem[]; focusPoints: string[] } {
  const mainSkill = requiredSkills[0] || candidateSkills[0] || offerTitle
  const missingSkill = requiredSkills.find(
    (req) => !candidateSkills.some((cs) => cs.toLowerCase() === req.toLowerCase()),
  )
  return {
    questions: [
      {
        category: 'experience',
        question: `Pouvez-vous détailler votre expérience la plus significative en lien avec le poste de ${offerTitle} ?`,
        intent: "Évaluer l'adéquation concrète du parcours avec les responsabilités du poste.",
      },
      {
        category: 'technique',
        question: `Sur ${mainSkill}, quel problème complexe avez-vous résolu récemment et comment avez-vous procédé ?`,
        intent: 'Vérifier la maîtrise pratique et la profondeur technique.',
      },
      {
        category: 'vigilance',
        question: missingSkill
          ? `Le poste demande des bases en ${missingSkill} : quelle est votre expérience ou capacité de montée en compétence sur ce point ?`
          : `Quelles compétences de l'offre pensez-vous devoir renforcer lors de votre prise de poste ?`,
        intent: 'Identifier les écarts éventuels et la capacité d’adaptation.',
      },
      {
        category: 'soft_skills',
        question: 'Comment organisez-vous vos priorités lorsque plusieurs tâches urgentes arrivent en même temps ?',
        intent: "Mesurer l'autonomie, la gestion du stress et la communication.",
      },
      {
        category: 'soft_skills',
        question: 'Quelles sont vos attentes principales pour la suite et votre disponibilité réelle pour démarrer ?',
        intent: 'Valider la motivation et la disponibilité opérationnelle.',
      },
    ],
    focusPoints: [
      `Vérifier l'expérience pratique de ${fullName} sur les compétences clés (${requiredSkills.slice(0, 3).join(', ') || offerTitle}).`,
      'Confirmer la disponibilité et l’autonomie sur les missions du poste.',
    ],
  }
}

/**
 * Compare les synthèses d'entretien de tous les candidats d'une offre pour
 * recommander le profil le plus pertinent et signaler nommément ceux qui
 * n'ont pas encore passé d'entretien.
 */
export async function compareCandidatesForOpportunity(
  opportunityId: string,
  recruiterId: string,
): Promise<OpportunityAiDecisionResult> {
  const opportunity = await prisma.opportunity.findUnique({
    where: { id: opportunityId },
    include: {
      matchSuggestions: {
        where: {
          status: { in: ['proposee_recruteur', 'interet_recruteur', 'mise_en_relation'] },
        },
        include: {
          candidate: { include: { candidateProfile: true } },
          interviews: {
            orderBy: { round: 'asc' },
            include: {
              meeting: {
                include: {
                  notes: { orderBy: { updatedAt: 'desc' }, take: 1 },
                  _count: { select: { transcripts: true } },
                },
              },
            },
          },
        },
      },
    },
  })

  if (!opportunity || opportunity.recruiterId !== recruiterId) {
    throw new Error('Offre introuvable ou accès non autorisé.')
  }

  const interviewed: Array<{
    suggestionId: string
    fullName: string
    skills: string[]
    notes: Array<{
      round: number
      summary: string
      strengths: string[]
      weaknesses: string[]
      technicalFitScore: number | null
      culturalFitScore: number | null
      recommendation: string | null
    }>
  }> = []

  const pendingCandidates: string[] = []

  for (const s of opportunity.matchSuggestions) {
    const fullName = s.candidate.candidateProfile?.fullName || 'Candidat sans nom'
    const notes = s.interviews
      .filter((iv) => iv.meeting && iv.meeting.notes.length > 0)
      .map((iv) => {
        const n = iv.meeting!.notes[0]
        return {
          round: iv.round,
          summary: n.summary,
          strengths: n.candidateStrengths,
          weaknesses: n.candidateWeaknesses,
          technicalFitScore: n.technicalFitScore,
          culturalFitScore: n.culturalFitScore,
          recommendation: n.recommendation,
        }
      })

    if (notes.length > 0) {
      interviewed.push({
        suggestionId: s.id,
        fullName,
        skills: s.candidate.candidateProfile?.skills ?? [],
        notes,
      })
    } else {
      pendingCandidates.push(fullName)
    }
  }

  if (interviewed.length === 0) {
    const emptyResult: OpportunityAiDecisionResult = {
      recommendedCandidate: null,
      ranking: [],
      pendingCandidates,
      summary:
        pendingCandidates.length > 0
          ? `Aucun candidat n'a encore de synthèse d'entretien pour le poste « ${opportunity.title} ». Candidats n'ayant pas encore passé d'entretien : ${pendingCandidates.join(', ')}.`
          : `Aucun candidat proposé pour l'instant sur le poste « ${opportunity.title} ».`,
      generatedAt: new Date().toISOString(),
    }
    await prisma.opportunity.update({
      where: { id: opportunity.id },
      data: { aiDecisionSummary: emptyResult as unknown as object },
    })
    return emptyResult
  }

  const candidatesContext = interviewed
    .map((c) => {
      const roundsText = c.notes
        .map(
          (n) =>
            `  Tour ${n.round}: Reco=${n.recommendation ?? 'n/a'}, Tech=${n.technicalFitScore ?? 'n/a'}%, Culture=${n.culturalFitScore ?? 'n/a'}% | Résumé: ${n.summary} | Forces: ${n.strengths.join('; ')} | Vigilance: ${n.weaknesses.join('; ')}`,
        )
        .join('\n')
      return `- [${c.suggestionId}] ${c.fullName} (Compétences: ${c.skills.slice(0, 6).join(', ')})\n${roundsText}`
    })
    .join('\n\n')

  const pendingNote =
    pendingCandidates.length > 0
      ? `\nCandidats n'ayant PAS encore passé d'entretien (à mentionner explicitement) : ${pendingCandidates.join(', ')}.`
      : ''

  const prompt = `
Tu es l'assistant d'aide à la décision RH d'OffRec (Madagascar).
Compare les synthèses d'entretien des candidats déjà évalués pour le poste « ${opportunity.title} » (compétences requises : ${opportunity.requiredSkills.join(', ')}) et aide le recruteur à choisir le profil le plus pertinent.

Candidats ayant une synthèse d'entretien :
${candidatesContext}
${pendingNote}

Retourne STRICTEMENT un JSON :
{
  "recommendedCandidate": {
    "suggestionId": "id exact du candidat le plus pertinent",
    "fullName": "Nom exact du candidat",
    "reason": "Explication brève et factuelle (2 phrases max) du pourquoi ce candidat est le plus pertinent"
  },
  "ranking": [
    {
      "suggestionId": "id exact",
      "fullName": "Nom exact",
      "rank": 1,
      "explanation": "Explication brève (1-2 phrases) de sa pertinence et points clés"
    }
  ],
  "summary": "Synthèse décisionnelle globale en 2-3 phrases (mentionnant explicitement s'il reste des candidats n'ayant pas encore passé d'entretien)"
}
`

  const fallback = () => {
    const scored = [...interviewed]
      .map((c) => {
        const last = c.notes[c.notes.length - 1]
        const avg = ((last.technicalFitScore ?? 50) + (last.culturalFitScore ?? 50)) / 2
        return { c, last, avg }
      })
      .sort((a, b) => b.avg - a.avg)

    const top = scored[0]
    return {
      recommendedCandidate: {
        suggestionId: top.c.suggestionId,
        fullName: top.c.fullName,
        reason: `Meilleure adéquation globale (${Math.round(top.avg)}%) sur la base de sa synthèse d'entretien.`,
      },
      ranking: scored.map((item, idx) => ({
        suggestionId: item.c.suggestionId,
        fullName: item.c.fullName,
        rank: idx + 1,
        explanation: item.last.summary,
      })),
      summary:
        pendingCandidates.length > 0
          ? `${top.c.fullName} ressort comme le profil le plus pertinent parmi les candidats déjà interviewés. Attention : ${pendingCandidates.join(', ')} n'ont pas encore passé d'entretien.`
          : `${top.c.fullName} ressort comme le profil le plus pertinent parmi les ${scored.length} candidats évalués.`,
    }
  }

  const parsed = await runStructuredAiJson<{
    recommendedCandidate?: { suggestionId: string; fullName: string; reason: string }
    ranking?: Array<{ suggestionId: string; fullName: string; rank: number; explanation: string }>
    summary?: string
  }>(prompt, fallback)

  const fb = fallback()
  const rankingInput = Array.isArray(parsed.ranking) && parsed.ranking.length > 0 ? parsed.ranking : fb.ranking

  const result: OpportunityAiDecisionResult = {
    recommendedCandidate: parsed.recommendedCandidate?.suggestionId ? parsed.recommendedCandidate : fb.recommendedCandidate,
    ranking: rankingInput.map((r, idx) => {
      const src = interviewed.find((c) => c.suggestionId === r.suggestionId)
      const last = src?.notes[src.notes.length - 1]
      return {
        suggestionId: r.suggestionId,
        fullName: src?.fullName || r.fullName,
        rank: r.rank ?? idx + 1,
        technicalFitScore: last?.technicalFitScore ?? null,
        culturalFitScore: last?.culturalFitScore ?? null,
        recommendation: last?.recommendation ?? null,
        explanation: r.explanation,
      }
    }),
    pendingCandidates,
    summary: parsed.summary || fb.summary,
    generatedAt: new Date().toISOString(),
  }

  await prisma.opportunity.update({
    where: { id: opportunity.id },
    data: { aiDecisionSummary: result as unknown as object },
  })

  return result
}
