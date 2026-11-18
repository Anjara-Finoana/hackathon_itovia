import { Router, type Request, type Response } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireAuth } from '../middleware/auth.js'
import { CustomBotProvider } from '../lib/bot/custom-bot.provider.js'
import { generateMeetingSynthesis } from '../lib/bot/meeting-synthesis.js'

const router = Router()
const botProvider = new CustomBotProvider()

/**
 * Initialise ou récupère la réunion associée à un entretien
 */
router.post('/init-from-interview', requireAuth, async (req: Request, res: Response) => {
  try {
    const { interviewId } = req.body
    if (!interviewId) {
      res.status(400).json({ error: 'interviewId requis' })
      return
    }

    const interview = await prisma.interview.findUnique({
      where: { id: interviewId },
      include: {
        suggestion: {
          include: {
            opportunity: true,
            candidate: true,
          },
        },
        meeting: {
          include: {
            bots: true,
            notes: true,
            actionItems: true,
          },
        },
      },
    })

    if (!interview) {
      res.status(404).json({ error: 'Entretien introuvable' })
      return
    }

    if (interview.meeting) {
      res.json({ meeting: interview.meeting })
      return
    }

    const hostId = req.session!.sub
    const participantId = interview.suggestion.candidateId
    const title = `Entretien : ${interview.suggestion.opportunity.title}`

    const meeting = await prisma.meeting.create({
      data: {
        title,
        meetUrl: interview.meetUrl || 'https://meet.google.com/new',
        interviewId: interview.id,
        hostId,
        participantId,
        scheduledAt: interview.scheduledAt,
      },
      include: {
        bots: true,
        notes: true,
        actionItems: true,
      },
    })

    res.status(201).json({ meeting })
  } catch (err) {
    console.error('[Meetings] Erreur init-from-interview:', err)
    res.status(500).json({ error: 'Erreur serveur lors de l initialisation de la réunion' })
  }
})

/**
 * Détail d'une réunion
 */
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const meeting = await prisma.meeting.findUnique({
      where: { id: req.params.id },
      include: {
        bots: { orderBy: { createdAt: 'desc' }, take: 1 },
        notes: { orderBy: { createdAt: 'desc' }, take: 1 },
        actionItems: { orderBy: { createdAt: 'asc' } },
      },
    })

    if (!meeting) {
      res.status(404).json({ error: 'Réunion introuvable' })
      return
    }

    res.json({ meeting })
  } catch (err) {
    res.status(500).json({ error: 'Erreur chargement réunion' })
  }
})

/**
 * Enregistrement du consentement légal (Double opt-in)
 */
router.post('/:id/consent', requireAuth, async (req: Request, res: Response) => {
  try {
    const { isRecruiter, consent } = req.body
    const meetingId = req.params.id

    const updateData = isRecruiter
      ? { recruiterConsent: Boolean(consent), recruiterConsentAt: consent ? new Date() : null }
      : { candidateConsent: Boolean(consent), candidateConsentAt: consent ? new Date() : null }

    const updated = await prisma.meeting.update({
      where: { id: meetingId },
      data: updateData,
    })

    res.json({ success: true, meeting: updated })
  } catch (err) {
    res.status(500).json({ error: 'Erreur enregistrement consentement' })
  }
})

/**
 * Lancer le bot dans la visioconférence
 */
router.post('/:id/bot/launch', requireAuth, async (req: Request, res: Response) => {
  try {
    const meetingId = req.params.id
    const meeting = await prisma.meeting.findUnique({
      where: { id: meetingId },
    })

    if (!meeting) {
      res.status(404).json({ error: 'Réunion introuvable' })
      return
    }

    if (!meeting.meetUrl) {
      res.status(400).json({ error: 'Lien de visioconférence manquant' })
      return
    }

    // Garde-fou légal : consentement recruteur requis
    if (!meeting.recruiterConsent) {
      res.status(400).json({
        error: "Consentement légal d'enregistrement obligatoire avant de déployer le bot.",
      })
      return
    }

    // Création ou mise à jour de l'instance MeetingBot
    let botInstance = await prisma.meetingBot.findFirst({
      where: { meetingId },
    })

    if (!botInstance) {
      botInstance = await prisma.meetingBot.create({
        data: {
          meetingId,
          provider: 'custom_headless',
          status: 'initialise',
          botName: 'Finoana Scribe',
        },
      })
    }

    const callbackUrl = `${process.env.API_INTERNAL_URL || 'http://api:4000'}/api/webhooks/bot/custom`

    const launchResult = await botProvider.launchBot({
      meetingId: meeting.id,
      meetUrl: meeting.meetUrl,
      botName: botInstance.botName,
      webhookCallbackUrl: callbackUrl,
    })

    await prisma.meetingBot.update({
      where: { id: botInstance.id },
      data: {
        status: 'connexion',
        externalBotId: launchResult.externalBotId,
        joinedAt: new Date(),
      },
    })

    await prisma.meeting.update({
      where: { id: meeting.id },
      data: {
        status: 'en_cours',
        startedAt: meeting.startedAt || new Date(),
      },
    })

    res.json({
      success: true,
      botId: botInstance.id,
      status: 'connexion',
      message: 'Bot déployé vers la visioconférence',
    })
  } catch (err) {
    console.error('[Meetings] Erreur bot/launch:', err)
    res.status(500).json({ error: (err as Error).message || 'Échec lancement du bot' })
  }
})

/**
 * Faire quitter le bot
 */
router.post('/:id/bot/leave', requireAuth, async (req: Request, res: Response) => {
  try {
    const meetingId = req.params.id
    const botInstance = await prisma.meetingBot.findFirst({
      where: { meetingId },
    })

    if (!botInstance) {
      res.status(404).json({ error: 'Aucun bot actif trouvé pour cette réunion' })
      return
    }

    await botProvider.leaveBot(botInstance.externalBotId || meetingId)

    await prisma.meetingBot.update({
      where: { id: botInstance.id },
      data: {
        status: 'termine',
        leftAt: new Date(),
      },
    })

    await prisma.meeting.update({
      where: { id: meetingId },
      data: {
        status: 'termine',
        endedAt: new Date(),
      },
    })

    res.json({ success: true, message: 'Le bot a quitté la visioconférence' })
  } catch (err) {
    res.status(500).json({ error: 'Erreur déconnexion bot' })
  }
})

/**
 * Récupération du flux en direct (statut bot + derniers transcripts)
 */
router.get('/:id/live', requireAuth, async (req: Request, res: Response) => {
  try {
    const meetingId = req.params.id
    const [meeting, transcripts] = await Promise.all([
      prisma.meeting.findUnique({
        where: { id: meetingId },
        include: {
          bots: { orderBy: { createdAt: 'desc' }, take: 1 },
          notes: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      }),
      prisma.transcript.findMany({
        where: { meetingId },
        orderBy: { startTime: 'asc' },
      }),
    ])

    if (!meeting) {
      res.status(404).json({ error: 'Réunion introuvable' })
      return
    }

    res.json({
      status: meeting.status,
      bot: meeting.bots[0] || null,
      note: meeting.notes[0] || null,
      transcripts,
    })
  } catch (err) {
    res.status(500).json({ error: 'Erreur consultation live' })
  }
})

/**
 * Générer (ou régénérer) la synthèse IA Gemini
 */
router.post('/:id/notes/generate', requireAuth, async (req: Request, res: Response) => {
  try {
    const meetingId = req.params.id
    const note = await generateMeetingSynthesis(meetingId)
    res.json({ success: true, note })
  } catch (err) {
    console.error('[Meetings] Erreur génération note:', err)
    res.status(500).json({ error: (err as Error).message || 'Échec de la synthèse IA' })
  }
})

/**
 * Mise à jour d'un ActionItem
 */
router.patch('/:id/action-items/:itemId', requireAuth, async (req: Request, res: Response) => {
  try {
    const { status, priority } = req.body
    const updated = await prisma.actionItem.update({
      where: { id: req.params.itemId },
      data: {
        ...(status ? { status } : {}),
        ...(priority ? { priority } : {}),
      },
    })
    res.json({ success: true, actionItem: updated })
  } catch (err) {
    res.status(500).json({ error: 'Erreur mise à jour tâche' })
  }
})

export default router
