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
}
