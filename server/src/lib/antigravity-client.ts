/**
 * Client pour l'API Antigravity (ai-api.wharton-aldrick.com)
 * Permet l'inférence textuelle et multimodale (fichiers/images/PDF)
 * via les endpoints /api/v1/one-shot et /api/v1/chat.
 */

export interface AntigravityTextOptions {
  prompt: string
  model?: string
  effort?: string
  timeoutMs?: number
}

export interface AntigravityFileOptions {
  prompt: string
  fileBuffer: Buffer
  filename?: string
  mimeType?: string
  model?: string
  effort?: string
  timeoutMs?: number
}

export interface AntigravityResponse {
  conversation_id: string
  status: string
  response: string
  duration_seconds: number
  num_turns: number
  usage?: {
    input_tokens: number
    output_tokens: number
    thinking_tokens?: number
    cache_read_tokens?: number
    total_tokens: number
  }
}

function getBaseUrl(): string {
  return (process.env.ANTIGRAVITY_API_URL || 'https://ai-api.wharton-aldrick.com').replace(/\/+$/, '')
}

function getApiKey(): string | undefined {
  return process.env.ANTIGRAVITY_API_KEY
}

function getDefaultModel(): string {
  return process.env.ANTIGRAVITY_API_MODEL || 'gemini-3.8-flash-low'
}

/**
 * Nettoie les blocs Markdown ```json ... ``` ou ``` ... ```
 * pour récupérer uniquement le contenu JSON brut.
 */
export function extractJsonFromMarkdown(text: string): string {
  const trimmed = text.trim()
  const codeBlockMatch = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i)
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim()
  }
  return trimmed
}

/**
 * Exécute une génération textuelle simple via /api/v1/one-shot
 */
export async function antigravityGenerateText(options: AntigravityTextOptions): Promise<string | null> {
  const apiKey = getApiKey()
  if (!apiKey) {
    console.warn('[AntigravityClient] ANTIGRAVITY_API_KEY non configurée.')
    return null
  }

  const baseUrl = getBaseUrl()
  const model = options.model || getDefaultModel()
  const timeoutMs = options.timeoutMs ?? 30000

  const formData = new FormData()
  formData.append('prompt', options.prompt)
  formData.append('model', model)
  if (options.effort) {
    formData.append('effort', options.effort)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(`${baseUrl}/api/v1/one-shot`, {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
      },
      body: formData,
      signal: controller.signal,
    })

    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      console.error(`[AntigravityClient] Erreur HTTP ${res.status}: ${errBody}`)
      return null
    }

    const data = (await res.json()) as AntigravityResponse
    return data.response ? data.response.trim() : null
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      console.error(`[AntigravityClient] Timeout dépassé (${timeoutMs}ms)`)
    } else {
      console.error('[AntigravityClient] Erreur réseau:', err)
    }
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Exécute une génération multimodale avec fichier (ex. PDF de CV) via /api/v1/one-shot
 */
export async function antigravityGenerateWithFile(options: AntigravityFileOptions): Promise<string | null> {
  const apiKey = getApiKey()
  if (!apiKey) {
    console.warn('[AntigravityClient] ANTIGRAVITY_API_KEY non configurée.')
    return null
  }

  const baseUrl = getBaseUrl()
  const model = options.model || getDefaultModel()
  const timeoutMs = options.timeoutMs ?? 45000
  const filename = options.filename || 'document.pdf'
  const mimeType = options.mimeType || 'application/pdf'

  const formData = new FormData()
  formData.append('prompt', options.prompt)
  formData.append('model', model)
  if (options.effort) {
    formData.append('effort', options.effort)
  }

  // Convertir le Buffer Node.js en Blob pour le FormData standard
  const fileBlob = new Blob([new Uint8Array(options.fileBuffer)], { type: mimeType })
  formData.append('files', fileBlob, filename)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(`${baseUrl}/api/v1/one-shot`, {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
      },
      body: formData,
      signal: controller.signal,
    })

    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      console.error(`[AntigravityClient] Erreur HTTP avec fichier ${res.status}: ${errBody}`)
      return null
    }

    const data = (await res.json()) as AntigravityResponse
    return data.response ? data.response.trim() : null
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      console.error(`[AntigravityClient] Timeout fichier dépassé (${timeoutMs}ms)`)
    } else {
      console.error('[AntigravityClient] Erreur réseau avec fichier:', err)
    }
    return null
  } finally {
    clearTimeout(timer)
  }
}
