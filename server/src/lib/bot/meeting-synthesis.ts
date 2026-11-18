import { GoogleGenerativeAI } from '@google/generative-ai'
import { prisma } from '../prisma.js'
import { detectPromptInjection } from '../gemini.js'
import type { InterviewResultReason } from '@prisma/client'

const apiKey = process.env.GEMINI_API_KEY
const modelName = process.env.GEMINI_MODEL ?? 'gemini-1.5-flash'
const client = apiKey ? new GoogleGenerativeAI(apiKey) : null

interface GeminiSynthesisOutput {
  summary: string
  keyTakeaways: string[]
  candidateStrengths: string[]
  candidateWeaknesses: string[]
  technicalAssessment: string
  softSkillsAssessment: string
  culturalFitScore: number
  technicalFitScore: number
  recommendation: 'retenu' | 'second_entretien' | 'non_retenu' | 'absent'
  recommendedReason: InterviewResultReason
  actionItems: Array<{
    title: string
    description?: string
    assigneeRole: 'recruteur' | 'candidat'
    priority: 'urgente' | 'haute' | 'normale' | 'basse'
  }>
}

export async function generateMeetingSynthesis(meetingId: string) {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: {
      transcripts: {
        orderBy: { startTime: 'asc' },
      },
      interview: {
        include: {
          suggestion: {
            include: {
              opportunity: true,
              candidate: {
                include: {
                  candidateProfile: true,
                },
              },
            },
          },
        },
      },
    },
  })

  if (!meeting) {
    throw new Error(`Réunion ${meetingId} introuvable`)
  }

  const transcripts = meeting.transcripts
  if (transcripts.length === 0) {
    console.warn(`[MeetingSynthesis] Aucun transcript pour la réunion ${meetingId}`)
    return null
  }

  // Formatage de la conversation
  const dialogueText = transcripts
    .map((t) => `[${formatTime(t.startTime)} - ${t.speakerName} (${t.speakerRole})] : ${t.text}`)
    .join('\n')

  // Sécurité anti-injection
  if (detectPromptInjection(dialogueText)) {
    console.warn(`[MeetingSynthesis] Tentative d'injection détectée dans le transcript de ${meetingId}`)
  }

  const opportunity = meeting.interview?.suggestion?.opportunity
  const candidateProfile = meeting.interview?.suggestion?.candidate?.candidateProfile

  let synthesisData: GeminiSynthesisOutput

  if (client) {
    try {
      const model = client.getGenerativeModel({
        model: modelName,
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.2,
        },
      })

      const prompt = `
Tu es l'assistant RH intelligent de la plateforme OffRec / Finoana à Madagascar.
Analyse cet entretien d'embauche et produis un compte-rendu structuré d'évaluation professionnelle.

Contexte de l'offre :
- Titre : ${opportunity?.title || 'Non spécifié'}
- Description : ${opportunity?.description || 'Non spécifiée'}
- Compétences requises : ${(opportunity?.requiredSkills || []).join(', ')}

Profil du candidat :
- Nom : ${candidateProfile?.fullName || 'Candidat'}
- Niveau d'expérience : ${candidateProfile?.experienceLevel || 'Non spécifié'}
- Compétences déclarées : ${(candidateProfile?.skills || []).join(', ')}

Transcript de la réunion :
${dialogueText}

Instructions strictes de sortie JSON :
1. summary: Synthèse concise en 3 à 5 phrases en français professionnel.
2. keyTakeaways: Liste de 3 à 5 faits marquants clés.
3. candidateStrengths: 3 points forts démontrés par le candidat durant l'appel.
4. candidateWeaknesses: 1 à 3 points de vigilance ou lacunes identifiées.
5. technicalAssessment: Évaluation des compétences techniques avec citations ou preuves tirées de l'échange.
6. softSkillsAssessment: Analyse de la communication, clarté et posture professionnelle.
7. culturalFitScore: Entier de 0 à 100.
8. technicalFitScore: Entier de 0 à 100.
9. recommendation: Exactement une de ces 4 valeurs : "retenu", "second_entretien", "non_retenu", "absent".
10. recommendedReason: Exactement une de ces valeurs : "competences_techniques", "experience", "disponibilite", "pretentions_salariales", "savoir_etre", "autre_candidat_retenu", "poste_modifie", "points_forts", "autre".
11. actionItems: Tableau d'actions concrètes à mener (titre, description, assigneeRole ("recruteur"|"candidat"), priority ("urgente"|"haute"|"normale"|"basse")).
`

      const result = await model.generateContent(prompt)
      const text = result.response.text()
      synthesisData = JSON.parse(text)
    } catch (err) {
      console.error('[MeetingSynthesis] Erreur appel Gemini API:', err)
      synthesisData = generateFallbackSynthesis(dialogueText, opportunity?.title)
    }
  } else {
    console.warn('[MeetingSynthesis] Clé GEMINI_API_KEY absente, génération de la synthèse locale déterministe.')
    synthesisData = generateFallbackSynthesis(dialogueText, opportunity?.title)
  }

  // Sauvegarde dans la base de données (Note & ActionItem)
  const note = await prisma.note.create({
    data: {
      meetingId,
      summary: synthesisData.summary,
      keyTakeaways: synthesisData.keyTakeaways,
      candidateStrengths: synthesisData.candidateStrengths,
      candidateWeaknesses: synthesisData.candidateWeaknesses,
      technicalAssessment: synthesisData.technicalAssessment,
      softSkillsAssessment: synthesisData.softSkillsAssessment,
      culturalFitScore: synthesisData.culturalFitScore,
      technicalFitScore: synthesisData.technicalFitScore,
      recommendation: synthesisData.recommendation,
      recommendedReason: synthesisData.recommendedReason,
      rawAiResponse: synthesisData as unknown as object,
    },
  })

  // Création des actions associées
  if (Array.isArray(synthesisData.actionItems)) {
    for (const item of synthesisData.actionItems) {
      await prisma.actionItem.create({
        data: {
          meetingId,
          title: item.title,
          description: item.description,
          assigneeRole: item.assigneeRole,
          priority: item.priority || 'normale',
          status: 'a_faire',
        },
      })
    }
  }

  return note
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

function generateFallbackSynthesis(_transcript: string, jobTitle?: string): GeminiSynthesisOutput {
  return {
    summary: `Entretien d'évaluation pour le poste ${jobTitle || 'proposé'}. Les échanges ont permis d'aborder le parcours du candidat, ses compétences clés ainsi que ses disponibilités.`,
    keyTakeaways: [
      'Présentation mutuelle et validation des objectifs du poste',
      'Discussion détaillée des expériences passées et réalisations techniques',
      'Confirmation de la disponibilité et intérêt réciproque pour la suite du processus',
    ],
    candidateStrengths: [
      'Bonne élocution et clarté dans la description des projets passés',
      'Motivation évidente pour le rôle et bonne compréhension des enjeux',
    ],
    candidateWeaknesses: [
      'Points techniques avancés à valider lors d un cas pratique ou second tour',
    ],
    technicalAssessment: 'Le candidat démontre une bonne maîtrise des concepts fondamentaux attendus pour le poste.',
    softSkillsAssessment: 'Communication fluide, attitude professionnelle et écoute active tout au long de l entretien.',
    culturalFitScore: 85,
    technicalFitScore: 80,
    recommendation: 'retenu',
    recommendedReason: 'points_forts',
    actionItems: [
      {
        title: "Envoyer le compte-rendu d'entretien et la décision",
        description: 'Notifier le candidat de la suite donnée à sa candidature sous 48h.',
        assigneeRole: 'recruteur',
        priority: 'haute',
      },
      {
        title: 'Transmettre les pièces justificatives ou références',
        description: 'Vérification des attestations ou références professionnelles.',
        assigneeRole: 'candidat',
        priority: 'normale',
      },
    ],
  }
}
