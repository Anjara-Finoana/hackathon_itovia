import type { IMeetingBotProvider, BotLaunchParams, BotLaunchResult } from './provider.interface.js'

export class CustomBotProvider implements IMeetingBotProvider {
  private botServiceUrl: string
  private internalSecret: string

  constructor() {
    this.botServiceUrl = process.env.BOT_SERVICE_URL || 'http://bot-service:5001'
    this.internalSecret = process.env.INTERNAL_BOT_SECRET || 'dev_secret_bot'
  }

  public async launchBot(params: BotLaunchParams): Promise<BotLaunchResult> {
    const res = await fetch(`${this.botServiceUrl}/bot/join`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Bot-Secret': this.internalSecret,
      },
      body: JSON.stringify({
        meetingId: params.meetingId,
        meetUrl: params.meetUrl,
        botName: params.botName || 'Finoana Scribe',
        webhookUrl: params.webhookCallbackUrl,
      }),
    })

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(`Échec lancement bot-service (${res.status}): ${err.error || res.statusText}`)
    }

    const data = (await res.json()) as { botId?: string; status?: string; message?: string }
    return {
      externalBotId: data.botId || params.meetingId,
      status: data.status || 'connexion',
      message: data.message,
    }
  }

  public async leaveBot(externalBotId: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.botServiceUrl}/bot/${externalBotId}/leave`, {
        method: 'POST',
        headers: {
          'X-Bot-Secret': this.internalSecret,
        },
      })
      return res.ok
    } catch (err) {
      console.warn(`[CustomBotProvider] Erreur déconnexion bot ${externalBotId}:`, err)
      return false
    }
  }

  public async getBotStatus(externalBotId: string): Promise<{ status: string; active: boolean }> {
    try {
      const res = await fetch(`${this.botServiceUrl}/bot/${externalBotId}/status`, {
        headers: {
          'X-Bot-Secret': this.internalSecret,
        },
      })
      if (!res.ok) return { status: 'inconnu', active: false }
      const data = (await res.json()) as { status: string; active: boolean }
      return { status: data.status, active: data.active }
    } catch {
      return { status: 'erreur_connexion', active: false }
    }
  }

  public async getSessionStatus(): Promise<{
    configured: boolean
    authFile?: string
    updatedAt?: string
    sizeBytes?: number
    cookiesCount?: number
    accountHint?: string
    error?: string
  }> {
    try {
      const res = await fetch(`${this.botServiceUrl}/bot/session/status`, {
        headers: {
          'X-Bot-Secret': this.internalSecret,
        },
      })
      if (!res.ok) {
        return { configured: false, error: `Service bot inaccessible (HTTP ${res.status})` }
      }
      return (await res.json()) as {
        configured: boolean
        authFile?: string
        updatedAt?: string
        sizeBytes?: number
        cookiesCount?: number
        accountHint?: string
      }
    } catch (err) {
      return { configured: false, error: (err as Error).message }
    }
  }

  public async updateSession(storageState: unknown): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      const res = await fetch(`${this.botServiceUrl}/bot/session/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Bot-Secret': this.internalSecret,
        },
        body: JSON.stringify({ storageState }),
      })
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; message?: string; error?: string }
      if (!res.ok) {
        return { success: false, error: data.error || `Erreur bot-service HTTP ${res.status}` }
      }
      return { success: true, message: data.message || 'Session mise à jour' }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }

  public async clearSession(): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      const res = await fetch(`${this.botServiceUrl}/bot/session/clear`, {
        method: 'POST',
        headers: {
          'X-Bot-Secret': this.internalSecret,
        },
      })
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; message?: string; error?: string }
      if (!res.ok) {
        return { success: false, error: data.error || `Erreur bot-service HTTP ${res.status}` }
      }
      return { success: true, message: data.message || 'Session supprimée' }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }

  public async getActiveSessions(): Promise<{ count: number; sessions: Array<{ id: string; status: string }> }> {
    try {
      const res = await fetch(`${this.botServiceUrl}/bot/sessions`, {
        headers: {
          'X-Bot-Secret': this.internalSecret,
        },
      })
      if (!res.ok) return { count: 0, sessions: [] }
      return (await res.json()) as { count: number; sessions: Array<{ id: string; status: string }> }
    } catch {
      return { count: 0, sessions: [] }
    }
  }
}
