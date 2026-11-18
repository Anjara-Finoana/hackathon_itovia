import { Readable, PassThrough } from 'node:stream'
import ffmpeg from 'fluent-ffmpeg'
import { WebSocket } from 'ws'

export interface TranscriptEvent {
  speakerName: string
  speakerRole: 'recruteur' | 'candidat' | 'observateur' | 'inconnu'
  speakerId?: string
  startTime: number
  endTime: number
  text: string
  confidence: number
  isFinal: boolean
}

export type TranscriptCallback = (event: TranscriptEvent) => void

export interface AudioPipelineConfig {
  deepgramApiKey?: string
  language?: string
  onTranscript: TranscriptCallback
  onError?: (err: Error) => void
  onClose?: () => void
}

export class AudioPipeline {
  private config: AudioPipelineConfig
  private ws: WebSocket | null = null
  private ffmpegCommand: ffmpeg.FfmpegCommand | null = null
  private pcmStream: PassThrough | null = null
  private isClosed = false
  private simulatedStartTime = Date.now()

  constructor(config: AudioPipelineConfig) {
    this.config = config
  }

  /**
   * Démarre le traitement audio depuis un flux WebM ou audio brut
   */
  public start(inputStream: Readable) {
    const apiKey = this.config.deepgramApiKey || process.env.DEEPGRAM_API_KEY

    if (!apiKey) {
      console.warn('[AudioPipeline] Aucune DEEPGRAM_API_KEY configurée. Passage en mode simulation pour le prototype.')
      this.startSimulatedPipeline()
      return
    }

    this.initDeepgramWebSocket(apiKey)
    this.initFfmpegTranscoder(inputStream)
  }

  private initDeepgramWebSocket(apiKey: string) {
    const lang = this.config.language || 'fr'
    const url = `wss://api.deepgram.com/v1/listen?model=nova-2&language=${lang}&smart_format=true&diarize=true&encoding=linear16&sample_rate=16000&channels=1`

    this.ws = new WebSocket(url, {
      headers: {
        Authorization: `Token ${apiKey}`,
      },
    })

    this.ws.on('open', () => {
      console.log('[AudioPipeline] Connexion WebSocket établie avec Deepgram Nova-2')
    })

    this.ws.on('message', (data: Buffer | string) => {
      try {
        const response = JSON.parse(data.toString())
        const alt = response.channel?.alternatives?.[0]
        if (!alt || !alt.transcript) return

        const isFinal = Boolean(response.is_final)
        const words = alt.words || []
        const speaker = words[0]?.speaker !== undefined ? `Participant ${words[0].speaker + 1}` : 'Intervenant'
        const speakerRole = words[0]?.speaker === 0 ? 'recruteur' : 'candidat'

        const event: TranscriptEvent = {
          speakerName: speaker,
          speakerRole,
          startTime: response.start || 0,
          endTime: (response.start || 0) + (response.duration || 0),
          text: alt.transcript,
          confidence: alt.confidence || 0.9,
          isFinal,
        }

        this.config.onTranscript(event)
      } catch (err) {
        console.error('[AudioPipeline] Erreur parsing message Deepgram:', err)
      }
    })

    this.ws.on('error', (err) => {
      console.error('[AudioPipeline] Erreur WebSocket Deepgram:', err)
      this.config.onError?.(err)
    })

    this.ws.on('close', () => {
      console.log('[AudioPipeline] Fermeture du WebSocket Deepgram')
      this.config.onClose?.()
    })
  }

  private initFfmpegTranscoder(inputStream: Readable) {
    this.pcmStream = new PassThrough()

    this.ffmpegCommand = ffmpeg(inputStream)
      .inputFormat('webm')
      .audioCodec('pcm_s16le')
      .audioChannels(1)
      .audioFrequency(16000)
      .format('s16le')
      .on('error', (err) => {
        if (!this.isClosed) {
          console.error('[AudioPipeline] Erreur conversion FFmpeg:', err.message)
        }
      })

    this.ffmpegCommand.pipe(this.pcmStream)

    // Découpage en frames audio de 100ms (3200 octets pour PCM 16kHz 16-bit mono)
    const CHUNK_SIZE = 3200
    let bufferAcc = Buffer.alloc(0)

    this.pcmStream.on('data', (chunk: Buffer) => {
      if (this.isClosed || !this.ws || this.ws.readyState !== WebSocket.OPEN) return

      bufferAcc = Buffer.concat([bufferAcc, chunk])
      while (bufferAcc.length >= CHUNK_SIZE) {
        const packet = bufferAcc.subarray(0, CHUNK_SIZE)
        bufferAcc = bufferAcc.subarray(CHUNK_SIZE)
        this.ws.send(packet)
      }
    })
  }

  /**
   * Mode de démonstration simulé en cas d'absence de clé API Deepgram
   */
  private startSimulatedPipeline() {
    this.simulatedStartTime = Date.now()
    const phrases = [
      { role: 'recruteur' as const, name: 'Recruteur', text: 'Bonjour, bienvenue à cet entretien pour OffRec.' },
      { role: 'candidat' as const, name: 'Candidat', text: 'Bonjour, merci pour cette opportunité.' },
      { role: 'recruteur' as const, name: 'Recruteur', text: 'Pouvez-vous me présenter vos compétences en développement Web et bases de données ?' },
      { role: 'candidat' as const, name: 'Candidat', text: "J'ai travaillé sur TypeScript, React et PostgreSQL pendant 3 ans, notamment sur des projets en production." },
      { role: 'recruteur' as const, name: 'Recruteur', text: 'Très bien, quelles sont vos disponibilités pour commencer à Antananarivo ?' },
      { role: 'candidat' as const, name: 'Candidat', text: 'Je suis disponible immédiatement dès le mois prochain.' },
    ]

    let index = 0
    const interval = setInterval(() => {
      if (this.isClosed || index >= phrases.length) {
        clearInterval(interval)
        return
      }

      const item = phrases[index]
      const elapsed = (Date.now() - this.simulatedStartTime) / 1000

      this.config.onTranscript({
        speakerName: item.name,
        speakerRole: item.role,
        startTime: elapsed,
        endTime: elapsed + 3.5,
        text: item.text,
        confidence: 0.98,
        isFinal: true,
      })

      index++
    }, 6000)
  }

  public stop() {
    this.isClosed = true
    if (this.ffmpegCommand) {
      try {
        this.ffmpegCommand.kill('SIGKILL')
      } catch {
        // Ignorer si déjà arrêté
      }
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: 'CloseStream' }))
        this.ws.close()
      } catch {
        // Ignorer
      }
    }
  }
}
