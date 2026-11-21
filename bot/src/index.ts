import express, { type Request, type Response } from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import fs from 'node:fs'
import path from 'node:path'
import { MeetSession } from './meet-session.js'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 5001
const INTERNAL_SECRET = process.env.INTERNAL_BOT_SECRET || 'dev_secret_bot'
const MAX_ACTIVE_BOTS = Number.parseInt(process.env.MAX_ACTIVE_BOTS || '2', 10)

app.use(cors())
app.use(express.json())

// Registre des sessions actives en mémoire
const activeSessions = new Map<string, MeetSession>()

// Middleware d'authentification interne
function requireInternalSecret(req: Request, res: Response, next: () => void) {
  const secret = req.headers['x-bot-secret']
  if (!secret || secret !== INTERNAL_SECRET) {
    res.status(401).json({ error: 'Accès non autorisé au service bot interne' })
    return
  }
  next()
}

// Healthcheck
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    activeBots: activeSessions.size,
    maxConcurrent: MAX_ACTIVE_BOTS,
    timestamp: new Date().toISOString(),
  })
})

// Liste des sessions actives
app.get('/bot/sessions', requireInternalSecret, (_req: Request, res: Response) => {
  const sessions = Array.from(activeSessions.entries()).map(([id, session]) => ({
    id,
    status: session.status,
  }))
  res.json({ count: sessions.length, sessions })
})

// Démarrer un bot
app.post('/bot/join', requireInternalSecret, async (req: Request, res: Response) => {
  const { meetingId, meetUrl, botName, webhookUrl } = req.body

  if (!meetingId || !meetUrl) {
    res.status(400).json({ error: 'Paramètres meetingId et meetUrl requis' })
    return
  }

  // Protection anti-surcharge OOM
  if (activeSessions.size >= MAX_ACTIVE_BOTS) {
    res.status(429).json({
      error: 'Capacité maximale de sessions simultanées atteinte sur cet hôte',
      activeSessions: activeSessions.size,
      maxAllowed: MAX_ACTIVE_BOTS,
    })
    return
  }

  // Si une session existe déjà pour ce meetingId, la retourner
  if (activeSessions.has(meetingId)) {
    const existing = activeSessions.get(meetingId)!
    res.json({
      success: true,
      botId: existing.id,
      status: existing.status,
      message: 'Session déjà en cours',
    })
    return
  }

  console.log(`[BotService] Démarrage bot pour réunion ${meetingId} -> ${meetUrl}`)

  const session = new MeetSession({
    meetingId,
    meetUrl,
    botName: botName || 'Finoana Scribe',
    webhookUrl: webhookUrl || `${process.env.API_INTERNAL_URL || 'http://api:4000'}/api/webhooks/bot/custom`,
    internalSecret: INTERNAL_SECRET,
    deepgramApiKey: process.env.DEEPGRAM_API_KEY,
    onStatusChange: (status) => {
      if (status === 'termine' || status === 'erreur') {
        activeSessions.delete(meetingId)
      }
    },
  })

  activeSessions.set(meetingId, session)

  // Lancement asynchrone pour répondre immédiatement
  session.start().catch((err) => {
    console.error(`[BotService] Erreur critique session ${meetingId}:`, err)
    activeSessions.delete(meetingId)
  })

  res.status(202).json({
    success: true,
    botId: session.id,
    status: 'connexion',
    message: 'Bot déployé avec succès',
  })
})

// Déconnecter un bot
app.post('/bot/:botId/leave', requireInternalSecret, async (req: Request, res: Response) => {
  const { botId } = req.params
  const session = activeSessions.get(botId)

  if (!session) {
    res.status(404).json({ error: 'Aucune session active pour cet identifiant' })
    return
  }

  console.log(`[BotService] Demande d évacuation pour session ${botId}`)
  await session.stop()
  activeSessions.delete(botId)

  res.json({ success: true, message: 'Bot déconnecté et ressources libérées' })
})

// Statut d'une session
app.get('/bot/:botId/status', requireInternalSecret, (req: Request, res: Response) => {
  const { botId } = req.params
  const session = activeSessions.get(botId)

  if (!session) {
    res.json({ botId, status: 'termine', active: false })
    return
  }

  res.json({
    botId: session.id,
    status: session.status,
    active: true,
  })
})

// --- Gestion de la session Google persistée du bot ---
const authDir = path.resolve(process.cwd(), 'auth')
const authFile = path.join(authDir, 'google-session.json')

app.get('/bot/session/status', requireInternalSecret, (_req: Request, res: Response) => {
  const exists = fs.existsSync(authFile)
  if (!exists) {
    res.json({ configured: false, authFile })
    return
  }

  try {
    const stats = fs.statSync(authFile)
    const content = fs.readFileSync(authFile, 'utf-8')
    let cookiesCount = 0
    let accountHint: string | null = null

    try {
      const parsed = JSON.parse(content)
      if (Array.isArray(parsed.cookies)) {
        cookiesCount = parsed.cookies.length
        for (const cookie of parsed.cookies) {
          if (typeof cookie.value === 'string' && cookie.value.includes('@gmail.com')) {
            const match = cookie.value.match(/[\w.-]+@gmail\.com/)
            if (match) accountHint = match[0]
          }
        }
      }
    } catch {
      // Erreur de parsing JSON bénigne
    }

    res.json({
      configured: true,
      authFile,
      updatedAt: stats.mtime.toISOString(),
      sizeBytes: stats.size,
      cookiesCount,
      accountHint: accountHint || process.env.GOOGLE_BOT_EMAIL || 'nomade.wanderer.2002@gmail.com',
    })
  } catch (err) {
    res.status(500).json({ configured: false, error: (err as Error).message })
  }
})

app.post('/bot/session/update', requireInternalSecret, (req: Request, res: Response) => {
  try {
    const { storageState } = req.body
    if (!storageState) {
      res.status(400).json({ error: 'Champ storageState requis' })
      return
    }

    let dataToWrite: string
    if (typeof storageState === 'string') {
      JSON.parse(storageState)
      dataToWrite = storageState
    } else if (typeof storageState === 'object') {
      dataToWrite = JSON.stringify(storageState, null, 2)
    } else {
      res.status(400).json({ error: 'storageState doit être un objet JSON ou une chaîne JSON' })
      return
    }

    if (!fs.existsSync(authDir)) {
      fs.mkdirSync(authDir, { recursive: true })
    }

    fs.writeFileSync(authFile, dataToWrite, 'utf-8')
    console.log(`[BotService] Session Google mise à jour dans ${authFile}`)

    res.json({
      success: true,
      message: 'Session Google mise à jour avec succès',
      updatedAt: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[BotService] Erreur mise à jour session Google:', err)
    res.status(500).json({ error: (err as Error).message })
  }
})

app.post('/bot/session/clear', requireInternalSecret, (_req: Request, res: Response) => {
  try {
    if (fs.existsSync(authFile)) {
      fs.unlinkSync(authFile)
      console.log(`[BotService] Session Google supprimée (${authFile})`)
    }
    res.json({ success: true, message: 'Session Google supprimée avec succès' })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.listen(PORT, () => {
  console.log(`[BotService] Finoana Scribe Microservice actif sur port ${PORT}`)
})
