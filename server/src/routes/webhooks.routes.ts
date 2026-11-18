import { Router, type Request, type Response } from 'express'
import { prisma } from '../lib/prisma.js'
import { generateMeetingSynthesis } from '../lib/bot/meeting-synthesis.js'
import type { MeetingBotStatus, SpeakerRole } from '@prisma/client'

const router = Router()
const INTERNAL_SECRET = process.env.INTERNAL_BOT_SECRET || 'dev_secret_bot'

/**
 * Webhook unifié recevant les événements du microservice bot-service
 */
router.post('/bot/custom', async (req: Request, res: Response) => {
  const secret = req.headers['x-bot-secret']
  if (!secret || secret !== INTERNAL_SECRET) {
    res.status(401).json({ error: 'Signature de webhook invalide' })
    return
  }

  const { event, payload } = req.body
  if (!event || !payload) {
    res.status(400).json({ error: 'Format de webhook invalide' })
    return
  }

  try {
    switch (event) {
      case 'bot.status_change': {
        const { meetingId, status, detail } = payload as {
          meetingId: string
          status: MeetingBotStatus
          detail?: string
        }

        await prisma.meetingBot.updateMany({
          where: { meetingId },
          data: {
            status,
            failureReason: detail || null,
          },
        })

        if (status === 'en_appel' || status === 'enregistrement') {
          await prisma.meeting.update({
            where: { id: meetingId },
            data: { status: 'en_cours' },
          })
        }
        break
      }

      case 'transcript.chunk': {
        const { meetingId, speakerName, speakerRole, startTime, endTime, text, confidence, isFinal } = payload as {
          meetingId: string
          speakerName: string
          speakerRole?: SpeakerRole
          startTime: number
          endTime: number
          text: string
          confidence?: number
          isFinal?: boolean
        }

        if (text && text.trim().length > 0) {
          await prisma.transcript.create({
            data: {
              meetingId,
              speakerName: speakerName || 'Intervenant',
              speakerRole: speakerRole || 'inconnu',
              startTime,
              endTime,
              text: text.trim(),
              confidence: confidence || 0.9,
              isFinal: isFinal !== undefined ? isFinal : true,
            },
          })
        }
        break
      }

      case 'call.ended': {
        const { meetingId, endedAt } = payload as { meetingId: string; endedAt: string }

        await prisma.meeting.update({
          where: { id: meetingId },
          data: {
            status: 'termine',
            endedAt: endedAt ? new Date(endedAt) : new Date(),
          },
        })

        await prisma.meetingBot.updateMany({
          where: { meetingId },
          data: {
            status: 'termine',
            leftAt: new Date(),
          },
        })

        // Déclenchement automatique asynchrone de la synthèse Gemini 1.5 Flash
        generateMeetingSynthesis(meetingId).catch((err) => {
          console.error(`[Webhooks] Échec synthèse post-call pour réunion ${meetingId}:`, err)
        })
        break
      }

      default:
        console.warn(`[Webhooks] Événement inconnu ignoré: ${event}`)
    }

    res.json({ received: true })
  } catch (err) {
    console.error('[Webhooks] Erreur traitement webhook:', err)
    res.status(500).json({ error: 'Erreur interne traitement webhook' })
  }
})

export default router
