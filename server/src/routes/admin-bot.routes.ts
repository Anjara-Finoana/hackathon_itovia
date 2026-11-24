import { createHash, randomBytes } from 'node:crypto'
import { Router, type Request, type Response } from 'express'
import { requireRole } from '../middleware/rbac.js'
import { CustomBotProvider } from '../lib/bot/custom-bot.provider.js'
import {
  clearGoogleCalendarOverride,
  getGoogleCalendarStatus,
  getGoogleOAuthClientConfig,
  setGoogleCalendarOverride,
  verifyAndFetchGoogleAccount,
} from '../lib/google-calendar.js'

const router = Router()
const botProvider = new CustomBotProvider()
const OAUTH_STATE_COOKIE = 'offrec_gcal_oauth_state'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ')

router.use(requireRole('admin'))

function resolvePublicOrigin(req: Request): string {
  const envOrigin = process.env.CORS_ORIGIN?.split(',')[0]?.trim()
  const host = req.get('host')
  if (host) {
    const proto = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : req.protocol
    return `${proto}://${host}`
  }
  return envOrigin || 'https://offrec.ffn-tech.com'
}

async function exchangeCodeForRefreshToken(params: {
  code: string
  redirectUri: string
  codeVerifier?: string
}): Promise<{ ok: true; refreshToken: string; email?: string } | { ok: false; error: string }> {
  const client = getGoogleOAuthClientConfig()
  if (!client) {
    return { ok: false, error: 'GOOGLE_CLIENT_ID ou GOOGLE_CLIENT_SECRET non configuré sur le serveur.' }
  }

  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    client_id: client.clientId,
    client_secret: client.clientSecret,
    redirect_uri: params.redirectUri,
  })
  if (params.codeVerifier) {
    form.set('code_verifier', params.codeVerifier)
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  })

  const body = (await response.json().catch(() => ({}))) as {
    access_token?: string
    refresh_token?: string
    error?: string
    error_description?: string
  }

  if (!response.ok || !body.refresh_token) {
    const detail = [body.error, body.error_description].filter(Boolean).join(' — ')
    return {
      ok: false,
      error: body.refresh_token === undefined && response.ok
        ? 'Google n’a pas renvoyé de refresh_token. Révoquez l’accès dans myaccount.google.com/permissions et réessayez.'
        : `Échec échange OAuth (HTTP ${response.status})${detail ? ` : ${detail}` : ''}`,
    }
  }

  let email: string | undefined
  if (body.access_token) {
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${body.access_token}` },
    }).catch(() => null)
    if (userRes && userRes.ok) {
      const info = (await userRes.json().catch(() => null)) as { email?: string } | null
      if (info?.email) email = info.email
    }
  }

  return { ok: true, refreshToken: body.refresh_token, email }
}

/**
 * Statut complet de l'agent Finoana Scribe et de l'intégration Google Meet / Calendar
 */
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const [sessionStatus, activeSessions] = await Promise.all([
      botProvider.getSessionStatus(),
      botProvider.getActiveSessions(),
    ])

    const calStatus = getGoogleCalendarStatus()
    const client = getGoogleOAuthClientConfig()
    const botEmail = process.env.GOOGLE_BOT_EMAIL?.trim() || 'nomade.wanderer.2002@gmail.com'

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
        configured: calStatus.configured,
        source: calStatus.source,
        organizerAccount: calStatus.organizerEmail || (calStatus.configured ? 'Compte configuré (.env)' : 'Non configuré'),
        calendarId: calStatus.calendarId,
        updatedAt: calStatus.updatedAt,
        hasOAuthClient: calStatus.hasOAuthClient,
        clientId: client?.clientId || null,
        botAttendeeEmail: botEmail,
      },
    })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

/**
 * Mise à jour de la session Google persistée du bot (Playwright storageState)
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

/**
 * Génère l'URL OAuth 1-clic pour connecter le compte Google organisateur (Calendar)
 */
router.get('/calendar/auth-url', (req: Request, res: Response) => {
  const client = getGoogleOAuthClientConfig()
  if (!client) {
    res.status(400).json({ error: 'GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET ne sont pas configurés sur le serveur.' })
    return
  }

  const state = randomBytes(16).toString('hex')
  const origin = resolvePublicOrigin(req)
  const redirectUri = `${origin}/api/admin/bot/calendar/callback`

  res.cookie(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: origin.startsWith('https://'),
    maxAge: 10 * 60 * 1000,
  })

  const url = new URL(GOOGLE_AUTH_URL)
  url.searchParams.set('client_id', client.clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', GOOGLE_SCOPES)
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('state', state)

  res.json({ url: url.toString(), redirectUri })
})

/**
 * Callback OAuth Google pour l'agenda organisateur
 */
router.get('/calendar/callback', async (req: Request, res: Response) => {
  const origin = resolvePublicOrigin(req)
  const redirectBack = (params: Record<string, string>) => {
    const target = new URL('/admin/agent-ia', origin)
    for (const [k, v] of Object.entries(params)) target.searchParams.set(k, v)
    res.redirect(target.toString())
  }

  const error = typeof req.query.error === 'string' ? req.query.error : null
  const code = typeof req.query.code === 'string' ? req.query.code : null
  const state = typeof req.query.state === 'string' ? req.query.state : null
  const expectedState = typeof req.cookies?.[OAUTH_STATE_COOKIE] === 'string' ? req.cookies[OAUTH_STATE_COOKIE] : null

  res.clearCookie(OAUTH_STATE_COOKIE)

  if (error || !code || !state || state !== expectedState) {
    redirectBack({ calendar_error: error ? `Autorisation refusée (${error})` : 'Session OAuth invalide ou expirée.' })
    return
  }

  try {
    const redirectUri = `${origin}/api/admin/bot/calendar/callback`
    const exchanged = await exchangeCodeForRefreshToken({ code, redirectUri })
    if (!exchanged.ok) {
      redirectBack({ calendar_error: exchanged.error })
      return
    }

    await setGoogleCalendarOverride({
      refreshToken: exchanged.refreshToken,
      organizerEmail: exchanged.email,
      calendarId: 'primary',
    })

    redirectBack({ calendar: 'connected' })
  } catch (err) {
    redirectBack({ calendar_error: (err as Error).message })
  }
})

/**
 * Enregistre un jeton Google Calendar obtenu via le script terminal (soit un refresh_token brut,
 * soit un payload JSON { code, redirectUri, codeVerifier } issu du flux PKCE loopback).
 */
router.post('/calendar/token', async (req: Request, res: Response) => {
  try {
    const raw = typeof req.body?.tokenOrPayload === 'string' ? req.body.tokenOrPayload.trim() : ''
    if (!raw) {
      res.status(400).json({ error: 'Jeton ou code manquant.' })
      return
    }

    let refreshToken = raw
    let organizerEmail: string | undefined

    if (raw.startsWith('{')) {
      let parsed: { code?: string; redirectUri?: string; codeVerifier?: string; refreshToken?: string }
      try {
        parsed = JSON.parse(raw)
      } catch {
        res.status(400).json({ error: 'Format JSON invalide.' })
        return
      }

      if (parsed.refreshToken) {
        refreshToken = parsed.refreshToken.trim()
      } else if (parsed.code && parsed.redirectUri) {
        const exchanged = await exchangeCodeForRefreshToken({
          code: parsed.code,
          redirectUri: parsed.redirectUri,
          codeVerifier: parsed.codeVerifier,
        })
        if (!exchanged.ok) {
          res.status(400).json({ error: exchanged.error })
          return
        }
        refreshToken = exchanged.refreshToken
        organizerEmail = exchanged.email
      } else {
        res.status(400).json({ error: 'Objet JSON incomplet (code/redirectUri ou refreshToken requis).' })
        return
      }
    }

    if (!organizerEmail) {
      const check = await verifyAndFetchGoogleAccount(refreshToken)
      if (!check.ok) {
        res.status(400).json({ error: check.error })
        return
      }
      organizerEmail = check.email
    }

    await setGoogleCalendarOverride({
      refreshToken,
      organizerEmail,
      calendarId: 'primary',
    })

    res.json({
      success: true,
      email: organizerEmail || null,
      message: organizerEmail
        ? `Compte Google organisateur connecté : ${organizerEmail}`
        : 'Compte Google organisateur connecté avec succès',
    })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

/**
 * Déconnecte la surcharge base de données du compte Google Calendar organisateur
 */
router.post('/calendar/disconnect', async (_req: Request, res: Response) => {
  try {
    await clearGoogleCalendarOverride()
    res.json({ success: true, message: 'Compte Google organisateur déconnecté (base de données réinitialisée).' })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// Garde createHash importé si besoin d'extension PKCE côté web ultérieure
void createHash

export default router
