import { Router, type Request, type Response } from 'express'
import { requireRole } from '../middleware/rbac.js'
import { CustomBotProvider } from '../lib/bot/custom-bot.provider.js'
import { isGoogleCalendarConfigured } from '../lib/google-calendar.js'

const router = Router()
const botProvider = new CustomBotProvider()

router.use(requireRole('admin'))

/**
 * Statut complet de l'agent Finoana Scribe et de l'intégration Google Meet / Calendar
 */
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const [sessionStatus, activeSessions] = await Promise.all([
      botProvider.getSessionStatus(),
      botProvider.getActiveSessions(),
    ])

    const calendarConfigured = isGoogleCalendarConfigured()
    const botEmail = process.env.GOOGLE_BOT_EMAIL?.trim() || 'nomade.wanderer.2002@gmail.com'
    const recruiterCalendar = process.env.GOOGLE_CALENDAR_ID?.trim() || 'lumine.aether.us@gmail.com'

    res.json({
      bot: {
        configured: sessionStatus.configured,
        accountHint: sessionStatus.accountHint || botEmail,
        updatedAt: sessionStatus.updatedAt,
        sizeBytes: sessionStatus.sizeBytes,
        cookiesCount: sessionStatus.cookiesCount,
        authFile: sessionStatus.authFile,
        error: sessionStatus.error,
        activeBotsCount: activeSessions.count,
        activeSessions: activeSessions.sessions,
      },
      calendar: {
        configured: calendarConfigured,
        organizerAccount: recruiterCalendar,
        botAttendeeEmail: botEmail,
      },
    })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

/**
 * Mise à jour de la session Google persistée (Playwright storageState)
 */
router.post('/session', async (req: Request, res: Response) => {
  try {
    const { storageState } = req.body
    if (!storageState) {
      res.status(400).json({ error: 'Fichier ou objet storageState manquant' })
      return
    }

    const result = await botProvider.updateSession(storageState)
    if (!result.success) {
      res.status(500).json({ error: result.error || 'Échec mise à jour session' })
      return
    }

    res.json({ success: true, message: result.message })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

/**
 * Déconnexion / suppression de la session Google du bot
 */
router.post('/disconnect', async (_req: Request, res: Response) => {
  try {
    const result = await botProvider.clearSession()
    if (!result.success) {
      res.status(500).json({ error: result.error || 'Échec suppression session' })
      return
    }

    res.json({ success: true, message: result.message })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

export default router
