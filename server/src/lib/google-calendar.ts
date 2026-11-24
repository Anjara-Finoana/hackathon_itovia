import { randomUUID } from 'node:crypto'
import { MADAGASCAR_TIME_ZONE } from '../../../src/lib/interview.js'
import { prisma } from './prisma.js'

/**
 * Agenda Google d'OffRec (décision produit 2026-10-14) — appels REST directs
 * en `fetch` (jeton OAuth par `refresh_token`, puis `events.insert` /
 * `patch` / `get` / `delete`), sans dépendance `googleapis`.
 *
 * Confidentialité (OffRec intermédiaire) : l'événement vit dans l'agenda
 * d'OffRec et n'a AUCUN invité (`attendees` jamais envoyé) — sinon Google
 * exposerait l'adresse du candidat au recruteur et inversement. Toutes les
 * écritures passent `sendUpdates=none` : Google n'envoie aucun email, c'est
 * OffRec qui transmet le lien à chacun. Titre et description ne contiennent
 * ni email ni téléphone.
 *
 * Sans `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN`,
 * le module est « non configuré » : l'appelant passe en mode simulé.
 *
 * Robustesse : délai maximal par appel (`GOOGLE_CALENDAR_TIMEOUT_MS`, 8 s
 * par défaut), une seule nouvelle tentative (erreur réseau, délai dépassé,
 * HTTP 429/5xx, ou 401 après renouvellement du jeton). Les erreurs sont
 * journalisées sans aucun secret (ni jeton, ni identifiant client).
 *
 * Tests uniquement : hors production, `GOOGLE_OAUTH_TOKEN_URL` et
 * `GOOGLE_CALENDAR_API_BASE` remplacent les adresses de Google (faux serveur
 * local). Ignorées quand `NODE_ENV=production`.
 */

const DEFAULT_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const DEFAULT_API_BASE = 'https://www.googleapis.com/calendar/v3'
const DEFAULT_TIMEOUT_MS = 8000

interface GoogleConfig {
  clientId: string
  clientSecret: string
  refreshToken: string
  calendarId: string
}

export interface CalendarOverrideConfig {
  refreshToken: string
  organizerEmail?: string
  calendarId?: string
  updatedAt?: string
}

const SETTING_KEY = 'google_calendar_organizer'
let calendarOverride: CalendarOverrideConfig | null = null
let cachedToken: { value: string; expiresAt: number; clientId: string } | null = null

export function getGoogleOAuthClientConfig(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() ?? ''
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() ?? ''
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

/** Charge la configuration Google Calendar enregistrée en base au démarrage du serveur. */
export async function initGoogleCalendarOverride(): Promise<void> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEY } })
    if (row && row.value && typeof row.value === 'object') {
      const val = row.value as Partial<CalendarOverrideConfig>
      if (typeof val.refreshToken === 'string' && val.refreshToken.trim()) {
        calendarOverride = {
          refreshToken: val.refreshToken.trim(),
          organizerEmail: typeof val.organizerEmail === 'string' ? val.organizerEmail : undefined,
          calendarId: typeof val.calendarId === 'string' ? val.calendarId : undefined,
          updatedAt: row.updatedAt.toISOString(),
        }
        cachedToken = null
      }
    }
  } catch (err) {
    console.warn('[google-calendar] Impossible de charger SystemSetting au démarrage:', (err as Error).message)
  }
}

export async function setGoogleCalendarOverride(input: CalendarOverrideConfig): Promise<void> {
  const value: CalendarOverrideConfig = {
    refreshToken: input.refreshToken.trim(),
    organizerEmail: input.organizerEmail?.trim() || undefined,
    calendarId: input.calendarId?.trim() || 'primary',
    updatedAt: new Date().toISOString(),
  }
  await prisma.systemSetting.upsert({
    where: { key: SETTING_KEY },
    create: { key: SETTING_KEY, value: value as unknown as object },
    update: { value: value as unknown as object },
  })
  calendarOverride = value
  cachedToken = null
}

export async function clearGoogleCalendarOverride(): Promise<void> {
  await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEY } })
  calendarOverride = null
  cachedToken = null
}

export function getGoogleCalendarStatus(): {
  configured: boolean
  source: 'database' | 'env' | 'none'
  organizerEmail: string | null
  calendarId: string
  updatedAt?: string
  hasOAuthClient: boolean
} {
  const client = getGoogleOAuthClientConfig()
  const dbToken = calendarOverride?.refreshToken?.trim()
  const envToken = process.env.GOOGLE_REFRESH_TOKEN?.trim()
  const source: 'database' | 'env' | 'none' = dbToken ? 'database' : envToken ? 'env' : 'none'
  return {
    configured: Boolean(client && (dbToken || envToken)),
    source,
    organizerEmail:
      calendarOverride?.organizerEmail ||
      (source === 'env' ? process.env.GOOGLE_ORGANIZER_EMAIL?.trim() || null : null),
    calendarId: calendarOverride?.calendarId || process.env.GOOGLE_CALENDAR_ID?.trim() || 'primary',
    updatedAt: calendarOverride?.updatedAt,
    hasOAuthClient: Boolean(client),
  }
}

/** Valide un refresh_token auprès de Google et tente de récupérer l'adresse email associée. */
export async function verifyAndFetchGoogleAccount(
  refreshToken: string,
): Promise<{ ok: true; email?: string } | { ok: false; error: string }> {
  const client = getGoogleOAuthClientConfig()
  if (!client) return { ok: false, error: 'GOOGLE_CLIENT_ID ou GOOGLE_CLIENT_SECRET manquant sur le serveur.' }

  try {
    const res = await httpCall(endpoints().tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: client.clientId,
        client_secret: client.clientSecret,
        refresh_token: refreshToken.trim(),
      }).toString(),
    })
    const body = res.body as { access_token?: string; error?: string; error_description?: string } | null
    if (res.status < 200 || res.status >= 300 || !body?.access_token) {
      return {
        ok: false,
        error: `Jeton refusé par Google (HTTP ${res.status})${body?.error_description ? ` : ${body.error_description}` : ''}.`,
      }
    }

    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${body.access_token}` },
    }).catch(() => null)
    let email: string | undefined
    if (userRes && userRes.ok) {
      const info = (await userRes.json().catch(() => null)) as { email?: string } | null
      if (info?.email) email = info.email
    }
    return { ok: true, email }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/** Lue à chaque appel : la configuration peut changer à chaud depuis l'interface admin. */
function readConfig(): GoogleConfig | null {
  const client = getGoogleOAuthClientConfig()
  const refreshToken = calendarOverride?.refreshToken?.trim() || process.env.GOOGLE_REFRESH_TOKEN?.trim() || ''
  if (!client || !refreshToken) return null
  return {
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    refreshToken,
    calendarId: calendarOverride?.calendarId || process.env.GOOGLE_CALENDAR_ID?.trim() || 'primary',
  }
}

export function isGoogleCalendarConfigured(): boolean {
  return readConfig() !== null
}

function endpoints(): { tokenUrl: string; apiBase: string } {
  const testOverride = process.env.NODE_ENV !== 'production'
  return {
    tokenUrl: (testOverride && process.env.GOOGLE_OAUTH_TOKEN_URL?.trim()) || DEFAULT_TOKEN_URL,
    apiBase: ((testOverride && process.env.GOOGLE_CALENDAR_API_BASE?.trim()) || DEFAULT_API_BASE).replace(/\/+$/, ''),
  }
}

function timeoutMs(): number {
  const value = Number(process.env.GOOGLE_CALENDAR_TIMEOUT_MS)
  return Number.isFinite(value) && value >= 500 ? value : DEFAULT_TIMEOUT_MS
}

export type CalendarResult<T> = { ok: true; value: T } | { ok: false; error: string; status?: number }

interface HttpOutcome {
  status: number
  body: unknown
}

/** Erreur réseau ou délai dépassé (pas de réponse HTTP). */
class TransportError extends Error {}

async function httpCall(url: string, init: RequestInit): Promise<HttpOutcome> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs())
  try {
    const res = await fetch(url, { ...init, signal: controller.signal })
    const text = await res.text()
    let body: unknown = null
    if (text) {
      try {
        body = JSON.parse(text)
      } catch {
        body = null
      }
    }
    return { status: res.status, body }
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError'
    throw new TransportError(aborted ? 'délai dépassé' : 'erreur réseau')
  } finally {
    clearTimeout(timer)
  }
}

const isRetriableStatus = (status: number) => status === 429 || status >= 500

/** Message d'erreur Google lisible, sans rien de sensible (pas de jeton dans ces champs). */
function googleErrorDetail(body: unknown): string {
  if (body && typeof body === 'object') {
    const error = (body as { error?: unknown }).error
    if (typeof error === 'string') return error
    if (error && typeof error === 'object') {
      const message = (error as { message?: unknown }).message
      if (typeof message === 'string') return message.slice(0, 160)
    }
  }
  return ''
}

function logFailure(operation: string, detail: string): void {
  console.error(`[google-calendar] ${operation} : ${detail}`)
}

/* ------------------------------------------------------------------ */
/* Jeton d'accès                                                       */
/* ------------------------------------------------------------------ */

async function accessToken(config: GoogleConfig, forceRefresh = false): Promise<CalendarResult<string>> {
  if (!forceRefresh && cachedToken && cachedToken.clientId === config.clientId && cachedToken.expiresAt > Date.now() + 60_000) {
    return { ok: true, value: cachedToken.value }
  }
  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
  })
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { status, body } = await httpCall(endpoints().tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      })
      const token = body && typeof body === 'object' ? (body as { access_token?: unknown; expires_in?: unknown }) : {}
      if (status >= 200 && status < 300 && typeof token.access_token === 'string') {
        const lifetime = typeof token.expires_in === 'number' ? token.expires_in : 3600
        cachedToken = { value: token.access_token, expiresAt: Date.now() + lifetime * 1000, clientId: config.clientId }
        return { ok: true, value: token.access_token }
      }
      const detail = googleErrorDetail(body)
      logFailure('jeton OAuth', `HTTP ${status}${detail ? ` (${detail})` : ''}`)
      if (!isRetriableStatus(status) || attempt === 1) {
        return {
          ok: false,
          error:
            status === 400 || status === 401
              ? 'Authentification Google refusée : vérifiez les identifiants OAuth (jeton de rafraîchissement expiré ou révoqué ?).'
              : `Service d’authentification Google indisponible (HTTP ${status}).`,
        }
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'erreur'
      logFailure('jeton OAuth', detail)
      if (attempt === 1) return { ok: false, error: `Service d’authentification Google injoignable (${detail}).` }
    }
  }
  return { ok: false, error: 'Service d’authentification Google injoignable.' }
}

/* ------------------------------------------------------------------ */
/* Appels à l'API Calendar                                             */
/* ------------------------------------------------------------------ */

/**
 * Un appel à l'API, avec au plus UNE nouvelle tentative : erreur réseau,
 * délai dépassé, HTTP 429/5xx, ou 401 (le jeton est alors renouvelé).
 * `acceptStatus` : statuts non-2xx considérés comme un succès (ex. 404/410
 * pour une suppression).
 */
async function calendarCall(
  operation: string,
  config: GoogleConfig,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  query: Record<string, string>,
  payload?: unknown,
  acceptStatus: number[] = [],
): Promise<CalendarResult<HttpOutcome>> {
  const url = `${endpoints().apiBase}${path}${Object.keys(query).length ? `?${new URLSearchParams(query)}` : ''}`
  let forceRefresh = false
  let lastError = 'Google Calendar injoignable.'
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await accessToken(config, forceRefresh)
    if (!token.ok) return token
    try {
      const outcome = await httpCall(url, {
        method,
        headers: {
          Authorization: `Bearer ${token.value}`,
          ...(payload !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: payload !== undefined ? JSON.stringify(payload) : undefined,
      })
      if ((outcome.status >= 200 && outcome.status < 300) || acceptStatus.includes(outcome.status)) {
        return { ok: true, value: outcome }
      }
      const detail = googleErrorDetail(outcome.body)
      logFailure(operation, `HTTP ${outcome.status}${detail ? ` (${detail})` : ''}`)
      lastError = `Google Calendar a refusé l’opération (HTTP ${outcome.status}).`
      if (outcome.status === 401) {
        forceRefresh = true
        continue
      }
      if (!isRetriableStatus(outcome.status)) return { ok: false, error: lastError, status: outcome.status }
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'erreur'
      logFailure(operation, detail)
      lastError = `Google Calendar injoignable (${detail}).`
    }
  }
  return { ok: false, error: lastError }
}

/* ------------------------------------------------------------------ */
/* Événements                                                          */
/* ------------------------------------------------------------------ */

export interface CalendarEventInput {
  /** Titre court, sans email ni téléphone. */
  summary: string
  /** Description, sans email ni téléphone. */
  description: string
  start: Date
  end: Date
  /** Identifiant OffRec du dossier (propriété privée de l'événement). */
  reference: string
}

export interface CalendarEventRef {
  eventId: string
  /** `null` si Google n'a pas (encore) généré de lien Meet. */
  meetUrl: string | null
}

/** Instant ISO avec le décalage de Madagascar (`+03:00`), lisible dans l'agenda. */
function madagascarIso(date: Date): string {
  const wall = new Date(date.getTime() + 3 * 60 * 60 * 1000)
  return `${wall.toISOString().slice(0, 19)}+03:00`
}

function eventTiming(input: Pick<CalendarEventInput, 'start' | 'end'>) {
  return {
    start: { dateTime: madagascarIso(input.start), timeZone: MADAGASCAR_TIME_ZONE },
    end: { dateTime: madagascarIso(input.end), timeZone: MADAGASCAR_TIME_ZONE },
  }
}

function conferenceRequest() {
  return { createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } }
}

/** Corps commun : Finoana Scribe en invité pour contourner le blocage Google Meet, invité incapable d'en inviter d'autres */
function eventBody(input: CalendarEventInput) {
  const botEmail = process.env.GOOGLE_BOT_EMAIL?.trim() || 'nomade.wanderer.2002@gmail.com'
  return {
    summary: input.summary,
    description: input.description,
    ...eventTiming(input),
    visibility: 'default',
    attendees: botEmail ? [{ email: botEmail, displayName: 'Finoana Scribe' }] : [],
    guestsCanInviteOthers: false,
    guestsCanSeeOtherGuests: false,
    reminders: { useDefault: true },
    extendedProperties: { private: { offrecReference: input.reference } },
  }
}

/** Lien Meet d'un événement renvoyé par Google — uniquement une adresse `https://meet.google.com/`. */
function extractMeetUrl(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const event = body as {
    hangoutLink?: unknown
    conferenceData?: { entryPoints?: Array<{ entryPointType?: unknown; uri?: unknown }> }
  }
  const candidates = [
    event.hangoutLink,
    ...(event.conferenceData?.entryPoints ?? []).filter((e) => e.entryPointType === 'video').map((e) => e.uri),
  ]
  for (const value of candidates) {
    if (typeof value === 'string' && /^https:\/\/meet\.google\.com\/[\w-]+/.test(value)) return value
  }
  return null
}

function eventIdOf(body: unknown): string | null {
  const id = body && typeof body === 'object' ? (body as { id?: unknown }).id : null
  return typeof id === 'string' && id ? id : null
}

const WRITE_QUERY = { conferenceDataVersion: '1', sendUpdates: 'none' }

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * La création de la conférence peut être asynchrone (`status: pending`) :
 * une seule relecture après une courte pause si le lien manque.
 */
async function withMeetUrl(config: GoogleConfig, eventId: string, body: unknown): Promise<CalendarEventRef> {
  const meetUrl = extractMeetUrl(body)
  if (meetUrl) return { eventId, meetUrl }
  await pause(1200)
  const read = await getEvent(config, eventId)
  return { eventId, meetUrl: read.ok ? read.value.meetUrl : null }
}

async function getEvent(config: GoogleConfig, eventId: string): Promise<CalendarResult<CalendarEventRef>> {
  const result = await calendarCall(
    'lecture d’événement',
    config,
    'GET',
    `/calendars/${encodeURIComponent(config.calendarId)}/events/${encodeURIComponent(eventId)}`,
    {},
  )
  if (!result.ok) return result
  return { ok: true, value: { eventId, meetUrl: extractMeetUrl(result.value.body) } }
}

function notConfigured(): { ok: false; error: string } {
  return { ok: false, error: 'Agenda Google non configuré.' }
}

/** Crée l'événement avec une demande de lien Meet. */
export async function createCalendarEvent(input: CalendarEventInput): Promise<CalendarResult<CalendarEventRef>> {
  const config = readConfig()
  if (!config) return notConfigured()
  const result = await calendarCall(
    'création d’événement',
    config,
    'POST',
    `/calendars/${encodeURIComponent(config.calendarId)}/events`,
    WRITE_QUERY,
    { ...eventBody(input), conferenceData: conferenceRequest() },
  )
  if (!result.ok) return result
  const eventId = eventIdOf(result.value.body)
  if (!eventId) {
    logFailure('création d’événement', 'réponse sans identifiant')
    return { ok: false, error: 'Réponse inattendue de Google Calendar.' }
  }
  return { ok: true, value: await withMeetUrl(config, eventId, result.value.body) }
}

/**
 * Met à jour horaire, titre et description. `ensureMeet` redemande un lien
 * Meet quand l'événement n'en a pas encore.
 */
export async function updateCalendarEvent(
  eventId: string,
  input: CalendarEventInput,
  ensureMeet: boolean,
): Promise<CalendarResult<CalendarEventRef>> {
  const config = readConfig()
  if (!config) return notConfigured()
  const result = await calendarCall(
    'mise à jour d’événement',
    config,
    'PATCH',
    `/calendars/${encodeURIComponent(config.calendarId)}/events/${encodeURIComponent(eventId)}`,
    WRITE_QUERY,
    { ...eventBody(input), ...(ensureMeet ? { conferenceData: conferenceRequest() } : {}) },
  )
  if (!result.ok) return result
  return { ok: true, value: await withMeetUrl(config, eventId, result.value.body) }
}

/** Supprime l'événement (déjà supprimé côté Google = succès). */
export async function deleteCalendarEvent(eventId: string): Promise<CalendarResult<null>> {
  const config = readConfig()
  if (!config) return notConfigured()
  const result = await calendarCall(
    'suppression d’événement',
    config,
    'DELETE',
    `/calendars/${encodeURIComponent(config.calendarId)}/events/${encodeURIComponent(eventId)}`,
    { sendUpdates: 'none' },
    undefined,
    [404, 410],
  )
  return result.ok ? { ok: true, value: null } : result
}
