import fs from 'node:fs'
import path from 'node:path'
import { PassThrough } from 'node:stream'
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
  private audioStream: PassThrough | null = null
  private isDestroyed = false

  constructor(config: MeetSessionConfig) {
    this.config = config
    this.id = config.meetingId
  }

  public async start(): Promise<void> {
    try {
      this.updateStatus('connexion', 'Lancement de Chromium...')

      const silenceFile = path.resolve(process.cwd(), 'assets', 'silence.wav')
      const launchArgs = [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        ...(fs.existsSync(silenceFile) ? [`--use-file-for-fake-audio-capture=${silenceFile}`] : []),
        '--autoplay-policy=no-user-gesture-required',
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ]

      this.browser = await chromium.launch({
        headless: false, // Nécessite Xvfb pour maintenir l'audio WebRTC
        args: launchArgs,
        ignoreDefaultArgs: ['--mute-audio'],
      })

      const authDir = path.resolve(process.cwd(), 'auth')
      const authFile = path.join(authDir, 'google-session.json')
      const hasAuth = fs.existsSync(authFile)

      if (hasAuth) {
        console.log(`[MeetSession:${this.id}] Chargement session Google authentifiée depuis ${authFile}`)
      } else {
        console.log(`[MeetSession:${this.id}] Aucune session Google détectée (${authFile}). Connexion anonyme.`)
      }

      this.context = await this.browser.newContext({
        ...(hasAuth ? { storageState: authFile } : {}),
        permissions: ['microphone', 'camera'],
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        locale: 'fr-FR',
      })

      // Masquage anti-automatisation
      await this.context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
      })

      this.page = await this.context.newPage()

      // Pont audio navigateur -> Node.js (flux WebM/Opus vers FFmpeg/Deepgram)
      await this.page.exposeFunction('__offrecPushAudioChunk', (base64: string) => {
        if (this.audioStream && !this.audioStream.destroyed && !this.isDestroyed) {
          this.audioStream.write(Buffer.from(base64, 'base64'))
        }
      })

      await this.page.addInitScript(`(() => {
        const remoteTracks = new Set();
        let audioCtx = null;
        let dest = null;
        let recorder = null;

        function attachTrack(track) {
          if (!track || track.kind !== 'audio' || remoteTracks.has(track)) return;
          remoteTracks.add(track);
          if (audioCtx && dest) {
            try {
              const src = audioCtx.createMediaStreamSource(new MediaStream([track]));
              src.connect(dest);
            } catch {}
          }
        }

        const OrigPC = window.RTCPeerConnection;
        if (OrigPC) {
          const WrappedPC = function (...args) {
            const pc = new OrigPC(...args);
            pc.addEventListener('track', (ev) => {
              if (ev.track) attachTrack(ev.track);
            });
            return pc;
          };
          WrappedPC.prototype = OrigPC.prototype;
          window.RTCPeerConnection = WrappedPC;
        }

        window.__offrecStartAudioCapture = () => {
          if (recorder) return;
          const AC = window.AudioContext || window.webkitAudioContext;
          audioCtx = new AC();
          dest = audioCtx.createMediaStreamDestination();

          // Source silencieuse pour garantir l'émission immédiate de l'en-tête WebM
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          gain.gain.value = 0;
          osc.connect(gain);
          gain.connect(dest);
          osc.start();

          for (const track of remoteTracks) {
            try {
              const src = audioCtx.createMediaStreamSource(new MediaStream([track]));
              src.connect(dest);
            } catch {}
          }

          document.querySelectorAll('audio, video').forEach((el) => {
            const stream = el && el.srcObject;
            if (stream && typeof stream.getAudioTracks === 'function') {
              stream.getAudioTracks().forEach(attachTrack);
            }
          });

          const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus'
            : 'audio/webm';
          recorder = new MediaRecorder(dest.stream, { mimeType });
          recorder.ondataavailable = async (ev) => {
            if (!ev.data || ev.data.size === 0) return;
            const buf = await ev.data.arrayBuffer();
            const bytes = new Uint8Array(buf);
            let bin = '';
            for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
            if (typeof window.__offrecPushAudioChunk === 'function') {
              window.__offrecPushAudioChunk(btoa(bin));
            }
          };
          recorder.start(1000);
        };
      })();`)

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

    try {
      await this.page.waitForTimeout(3000)

      // 1. Détection immédiate du blocage d'accès Google Meet (Hôte non connecté ou restriction)
      const initialText = await this.page.innerText('body').catch(() => '')
      if (
        initialText.includes("can't join this video call") ||
        initialText.includes('ne pouvez pas participer') ||
        initialText.includes('unless invited or admitted by the host') ||
        initialText.includes('sauf si l’hôte')
      ) {
        throw new Error(
          'L’hôte doit d’abord ouvrir et rejoindre l’appel Google Meet avant de faire entrer le bot.'
        )
      }

      // 2. Couper explicitement micro et caméra (idempotent, évite les bascules accidentelles)
      await this.ensureMicAndCameraOff()

      // 3. Fermer les modales de permission/avertissement caméra/micro si présentes
      const dismissModalSelectors = [
        'button:has-text("Continuer sans micro")',
        'button:has-text("Continue without microphone")',
        'button:has-text("Continuer sans")',
        'button:has-text("Dismiss")',
        'button:has-text("Ignorer")',
      ]
      for (const sel of dismissModalSelectors) {
        const btn = this.page.locator(sel).first()
        if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
          await btn.click().catch(() => {})
          await this.page.waitForTimeout(500)
          break
        }
      }

      // 4. Saisie robuste du nom avec locator Playwright (évite l'erreur de nœud détaché)
      const nameLocator = this.page
        .locator('input[type="text"], input[aria-label*="nom" i], input[aria-label*="name" i]')
        .first()
      const hasNameInput = await nameLocator.isVisible({ timeout: 4000 }).catch(() => false)
      if (hasNameInput) {
        await nameLocator.fill(this.config.botName || 'Finoana Scribe')
        await this.page.waitForTimeout(500)
      }

      await this.saveScreenshot('01-pre-join')

      // 4b. Vérifier si le bot est déjà directement dans l'appel (ex. /new ou entrée auto)
      if (await this.isAlreadyInCall()) {
        console.log(`[MeetSession:${this.id}] Bot déjà dans l'appel Google Meet dès l'ouverture.`)
        await this.ensureMicAndCameraOff()
        this.updateStatus('en_appel', 'Connecté à la réunion')
        this.startRecording()
        return
      }

      // 5. Clic sur le bouton de participation
      const joinButtonSelectors = [
        'button:has-text("Participer à la réunion")',
        'button:has-text("Participer maintenant")',
        'button:has-text("Participer")',
        'button:has-text("Demander à participer")',
        'button:has-text("Ask to join")',
        'button:has-text("Join now")',
        'button:has-text("Join meeting")',
        'button:has-text("Join")',
        'button[jsname="Qx7uuf"]',
        'div[role="button"]:has-text("Participer à la réunion")',
        'div[role="button"]:has-text("Participer maintenant")',
        'div[role="button"]:has-text("Demander à participer")',
        'div[role="button"]:has-text("Ask to join")',
        'div[role="button"]:has-text("Participer")',
        'div[role="button"]:has-text("Join now")',
      ]

      let joined = false
      for (const selector of joinButtonSelectors) {
        const btn = this.page.locator(selector).first()
        if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
          console.log(`[MeetSession:${this.id}] Clic sur le bouton de participation : ${selector}`)
          await btn.click().catch(() => {})
          joined = true
          break
        }
      }

      await this.page.waitForTimeout(2000)
      await this.saveScreenshot('02-after-click')
      const postClickText = await this.page.innerText('body').catch(() => '')
      console.log(`[MeetSession:${this.id}] Post-clic DOM text:\n`, postClickText.slice(0, 300))

      if (!joined) {
        const latestText = await this.page.innerText('body').catch(() => '')
        if (
          latestText.includes("can't join this video call") ||
          latestText.includes('ne pouvez pas participer')
        ) {
          throw new Error('L’hôte doit rejoindre la réunion Google Meet avant de déployer le bot.')
        }
        throw new Error('Bouton pour demander à participer à Google Meet introuvable.')
      }

      // Vérifier si le bot est entré directement (compte invité ou appel ouvert)
      if (await this.isAlreadyInCall()) {
        console.log(`[MeetSession:${this.id}] Bot entré directement dans la réunion (compte Google invité/admis).`)
        await this.ensureMicAndCameraOff()
        this.updateStatus('en_appel', 'Connecté à la réunion')
        this.startRecording()
        return
      }

      // 6. Mise à jour du statut en salle d'attente si pas encore admis
      this.updateStatus('salle_attente', 'En attente d admission par l hôte...')

      // 7. Détection de l'admission dans la réunion
      this.monitorCallAdmission()
    } catch (err) {
      console.warn(`[MeetSession:${this.id}] Erreur interaction Google Meet:`, (err as Error).message)
      await this.saveScreenshot('04-error')
      this.updateStatus('erreur', (err as Error).message)
      await this.stop()
    }
  }

  private async ensureMicAndCameraOff(): Promise<void> {
    if (!this.page) return
    const offSelectors = [
      'button[aria-label*="Désactiver le micro" i], button[aria-label*="Turn off microphone" i], div[role="button"][aria-label*="Désactiver le micro" i], div[role="button"][aria-label*="Turn off microphone" i]',
      'button[aria-label*="Désactiver la caméra" i], button[aria-label*="Turn off camera" i], div[role="button"][aria-label*="Désactiver la caméra" i], div[role="button"][aria-label*="Turn off camera" i]',
    ]
    for (const selector of offSelectors) {
      const btn = this.page.locator(selector).first()
      if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await btn.click().catch(() => {})
        await this.page.waitForTimeout(250)
      }
    }
  }

  private async isAlreadyInCall(): Promise<boolean> {
    if (!this.page) return false
    const inCallSelector = [
      'button[aria-label*="quitter" i]',
      'button[aria-label*="leave" i]',
      'button[data-call-ended="false"]',
      'div[role="button"][aria-label*="quitter" i]',
      'div[role="button"][aria-label*="leave" i]',
    ].join(', ')
    const btn = await this.page.$(inCallSelector)
    if (btn) return true
    const body = await this.page.innerText('body').catch(() => '')
    return (
      body.includes('Meeting details') ||
      body.includes('Détails de la réunion') ||
      body.includes('Send a reaction') ||
      body.includes('Envoyer une réaction')
    )
  }

  private async saveScreenshot(name: string): Promise<void> {
    if (!this.page) return
    try {
      const debugDir = path.resolve(process.cwd(), 'debug')
      if (!fs.existsSync(debugDir)) {
        fs.mkdirSync(debugDir, { recursive: true })
      }
      const filePath = path.join(debugDir, `${this.id}_${name}.png`)
      await this.page.screenshot({ path: filePath, fullPage: true }).catch(() => {})
      console.log(`[MeetSession:${this.id}] Capture d'écran enregistrée : ${filePath}`)
    } catch (err) {
      console.warn(`[MeetSession:${this.id}] Impossible d'enregistrer capture:`, err)
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
      if (checkCount === 1 || checkCount % 6 === 0) {
        await this.saveScreenshot(`03-waiting-${checkCount}`)
      }
      try {
        // En appel si le bouton raccrocher ou l'interface d'appel est visible
        const inCall = await this.isAlreadyInCall()

        if (inCall && this.status !== 'en_appel' && this.status !== 'enregistrement') {
          clearInterval(interval)
          await this.ensureMicAndCameraOff()
          this.updateStatus('en_appel', 'Admis dans la réunion')
          this.startRecording()
          return
        }

        // Détecter si l'hôte a explicitement refusé l'accès
        const bodyText = await this.page.innerText('body').catch(() => '')
        if (
          bodyText.includes("can't join this call") ||
          bodyText.includes('refusé') ||
          bodyText.includes('denied')
        ) {
          clearInterval(interval)
          await this.saveScreenshot('04-refused')
          this.updateStatus('erreur', 'L’hôte a refusé la demande d’admission du bot.')
          await this.stop()
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

    // Démarrage du pipeline sur un flux PassThrough alimenté par MediaRecorder dans le navigateur
    this.audioStream = new PassThrough()
    this.audioPipeline.start(this.audioStream)

    if (this.page) {
      this.page
        .evaluate(() => {
          const start = (globalThis as unknown as Record<string, (() => void) | undefined>).__offrecStartAudioCapture
          start?.()
        })
        .catch((err) => {
          console.warn(`[MeetSession:${this.id}] Impossible de démarrer la capture audio navigateur:`, err)
        })
    }
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

    if (this.audioStream && !this.audioStream.destroyed) {
      this.audioStream.end()
      this.audioStream = null
    }

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
