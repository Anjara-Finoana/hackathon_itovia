import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { AudioPipeline, type TranscriptEvent } from './audio-pipeline.js'

export type MeetingBotStatus =
  | 'initialise'
  | 'connexion'
  | 'salle_attente'
  | 'en_appel'
  | 'enregistrement'
  | 'deconnexion'
  | 'termine'
  | 'erreur'

export interface MeetSessionConfig {
  meetingId: string
  meetUrl: string
  botName: string
  webhookUrl: string
  internalSecret: string
  deepgramApiKey?: string
  onStatusChange?: (status: MeetingBotStatus, detail?: string) => void
}

export class MeetSession {
  public id: string
  public status: MeetingBotStatus = 'initialise'
  private config: MeetSessionConfig
  private browser: Browser | null = null
  private context: BrowserContext | null = null
  private page: Page | null = null
  private audioPipeline: AudioPipeline | null = null
  private isDestroyed = false

  constructor(config: MeetSessionConfig) {
    this.config = config
    this.id = config.meetingId
  }

  public async start(): Promise<void> {
    try {
      this.updateStatus('connexion', 'Lancement de Chromium...')

      this.browser = await chromium.launch({
        headless: false, // Nécessite Xvfb pour maintenir l'audio WebRTC
        args: [
          '--use-fake-ui-for-media-stream',
          '--use-fake-device-for-media-stream',
          '--autoplay-policy=no-user-gesture-required',
          '--disable-blink-features=AutomationControlled',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
        ignoreDefaultArgs: ['--mute-audio'],
      })

      this.context = await this.browser.newContext({
        permissions: ['microphone', 'camera'],
        userAgent:
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      })

      this.page = await this.context.newPage()

      // Navigation vers l'URL
      console.log(`[MeetSession:${this.id}] Navigation vers ${this.config.meetUrl}`)
      await this.page.goto(this.config.meetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })

      // Automatisation spécifique Google Meet
      if (this.config.meetUrl.includes('meet.google.com')) {
        await this.handleGoogleMeet()
      } else {
        // Autre plateforme (Zoom web client, etc.)
        await this.handleGenericPlatform()
      }
    } catch (err) {
      console.error(`[MeetSession:${this.id}] Erreur de session:`, err)
      this.updateStatus('erreur', (err as Error).message)
      await this.stop()
    }
  }

  private async handleGoogleMeet(): Promise<void> {
    if (!this.page) return

    // Attente du champ de saisie du nom ou des contrôles d'avant-appel
    try {
      await this.page.waitForTimeout(2000)

      // 1. Désactiver micro et caméra si possible via raccourcis clavier
      await this.page.keyboard.press('Control+d').catch(() => {})
      await this.page.keyboard.press('Control+e').catch(() => {})

      // 2. Saisie du nom
      const nameInput = await this.page.$('input[type="text"]')
      if (nameInput) {
        await nameInput.fill(this.config.botName || 'Finoana Scribe')
        await this.page.waitForTimeout(500)
      }

      // 3. Clic sur "Demander à participer" ou "Participer"
      this.updateStatus('salle_attente', 'En attente d admission par l hôte...')

      const joinButtonSelectors = [
        'button:has-text("Participer")',
        'button:has-text("Demander à participer")',
        'button:has-text("Ask to join")',
        'button:has-text("Join now")',
      ]

      for (const selector of joinButtonSelectors) {
        const btn = await this.page.$(selector)
        if (btn) {
          await btn.click()
          break
        }
      }

      // 4. Détection de l'admission dans la réunion
      this.monitorCallAdmission()
    } catch (err) {
      console.warn(`[MeetSession:${this.id}] Avertissement interaction Google Meet:`, err)
      this.monitorCallAdmission()
    }
  }

  private monitorCallAdmission(): void {
    let checkCount = 0
    const interval = setInterval(async () => {
      if (this.isDestroyed || !this.page) {
        clearInterval(interval)
        return
      }

      checkCount++
      try {
        // En appel si le bouton raccrocher (bouton rouge avec icône d'appel) ou la liste des participants est visible
        const leaveBtn = await this.page.$(
          'button[aria-label*="quitter" i], button[aria-label*="leave" i], button[data-call-ended="false"]',
        )

        if (leaveBtn && this.status !== 'en_appel' && this.status !== 'enregistrement') {
          clearInterval(interval)
          this.updateStatus('en_appel', 'Admis dans la réunion')
          this.startRecording()
          return
        }

        // Timeout après 15 minutes d'attente d'admission
        if (checkCount > 180) {
          clearInterval(interval)
          this.updateStatus('erreur', 'Délai d admission dépassé (15 min)')
          await this.stop()
        }
      } catch {
        // Ignorer les erreurs d'évaluation DOM ponctuelles
      }
    }, 5000)
  }

  private async handleGenericPlatform(): Promise<void> {
    this.updateStatus('en_appel', 'Connecté à la session')
    this.startRecording()
  }

  private startRecording(): void {
    this.updateStatus('enregistrement', 'Transcription en cours')

    this.audioPipeline = new AudioPipeline({
      deepgramApiKey: this.config.deepgramApiKey,
      onTranscript: (event: TranscriptEvent) => {
        this.emitWebhook('transcript.chunk', {
          meetingId: this.id,
          ...event,
        })
      },
      onError: (err) => {
        console.error(`[MeetSession:${this.id}] Erreur pipeline audio:`, err)
      },
    })

    // Démarrage du pipeline
    // Dans le conteneur, un flux PassThrough ou simulation diffuse l'audio vers Deepgram
    this.audioPipeline.start(process.stdin)
  }

  private updateStatus(status: MeetingBotStatus, detail?: string) {
    this.status = status
    console.log(`[MeetSession:${this.id}] Statut -> ${status} ${detail ? `(${detail})` : ''}`)
    this.config.onStatusChange?.(status, detail)

    this.emitWebhook('bot.status_change', {
      meetingId: this.id,
      status,
      detail,
    })
  }

  private emitWebhook(event: string, payload: unknown) {
    const targetUrl = this.config.webhookUrl
    if (!targetUrl) return

    fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Bot-Secret': this.config.internalSecret,
      },
      body: JSON.stringify({
        event,
        timestamp: new Date().toISOString(),
        payload,
      }),
    }).catch((err) => {
      console.warn(`[MeetSession:${this.id}] Échec émission webhook ${event}:`, err.message)
    })
  }

  public async stop(): Promise<void> {
    if (this.isDestroyed) return
    this.isDestroyed = true

    this.updateStatus('deconnexion', 'Arrêt du bot et libération des ressources')

    if (this.audioPipeline) {
      this.audioPipeline.stop()
      this.audioPipeline = null
    }

    if (this.page) {
      await this.page.close().catch(() => {})
      this.page = null
    }

    if (this.context) {
      await this.context.close().catch(() => {})
      this.context = null
    }

    if (this.browser) {
      await this.browser.close().catch(() => {})
      this.browser = null
    }

    this.updateStatus('termine', 'Appel terminé')
    this.emitWebhook('call.ended', {
      meetingId: this.id,
      endedAt: new Date().toISOString(),
    })
  }
}
