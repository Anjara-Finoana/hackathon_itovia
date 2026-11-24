/**
 * Script autonome de connexion Google Calendar (Organisateur OffRec)
 * Compatible avec les clients OAuth "Application de bureau" (loopback 127.0.0.1)
 * sans jamais exposer GOOGLE_CLIENT_SECRET.
 *
 * Utilisation :
 *   node /tmp/offrec-cal-login.mjs <GOOGLE_CLIENT_ID>
 */

import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import os from 'node:os'

const clientId = (process.argv[2] || '').trim()
if (!clientId) {
  console.error('❌ GOOGLE_CLIENT_ID manquant en argument. Copiez la commande complète depuis /admin/agent-ia.')
  process.exit(1)
}

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ')

const base64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const verifier = base64url(randomBytes(32))
const challenge = base64url(createHash('sha256').update(verifier).digest())
const state = base64url(randomBytes(16))

function tryOpenBrowser(url) {
  const platform = os.platform()
  try {
    if (platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref()
    } else if (platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref()
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref()
    }
  } catch {
    // L'utilisateur peut toujours cliquer sur l'URL affichée
  }
}

function tryCopyToClipboard(text) {
  const platform = os.platform()
  const commands =
    platform === 'darwin'
      ? [['pbcopy', []]]
      : platform === 'win32'
        ? [['clip', []]]
        : [
            ['wl-copy', []],
            ['xclip', ['-selection', 'clipboard']],
            ['xsel', ['--clipboard', '--input']],
          ]

  for (const [cmd, args] of commands) {
    const res = spawnSync(cmd, args, {
      input: text,
      encoding: 'utf-8',
      stdio: ['pipe', 'ignore', 'ignore'],
      timeout: 1500,
    })
    if (res.status === 0) return true
  }
  return false
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  if (url.pathname !== '/') {
    res.writeHead(404).end()
    return
  }

  const error = url.searchParams.get('error')
  const code = url.searchParams.get('code')
  if (error || !code || url.searchParams.get('state') !== state) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end(
      '<h3>Autorisation refusée ou invalide.</h3><p>Vous pouvez fermer cet onglet et réessayer.</p>',
    )
    console.error(`\n❌ Autorisation refusée ou invalide${error ? ` (${error})` : ''}.`)
    server.close(() => process.exit(1))
    return
  }

  const { port } = server.address()
  const redirectUri = `http://127.0.0.1:${port}`
  const payload = JSON.stringify({ code, redirectUri, codeVerifier: verifier })

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(
    '<h2>✅ Autorisation réussie !</h2><p>Vous pouvez fermer cet onglet et revenir sur votre terminal.</p>',
  )

  console.log('\n✅ Autorisation Google reçue avec succès !')
  console.log('\n==================== COPIEZ LE CODE CI-DESSOUS ====================')
  console.log(payload)
  console.log('====================== FIN DU CODE ===============================')

  if (tryCopyToClipboard(payload)) {
    console.log('📋 Le code a également été copié dans votre presse-papier !')
  }
  console.log('\n👉 Retournez sur /admin/agent-ia dans OffRec, collez ce code dans « Jeton / Code Agenda » et validez.\n')

  server.close(() => process.exit(0))
})

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address()
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', `http://127.0.0.1:${port}`)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', SCOPES)
  authUrl.searchParams.set('access_type', 'offline')
  authUrl.searchParams.set('prompt', 'consent')
  authUrl.searchParams.set('code_challenge', challenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')
  authUrl.searchParams.set('state', state)

  console.log('\n==============================================================')
  console.log('📅 OffRec — Connexion du Compte Google Organisateur')
  console.log('==============================================================')
  console.log('🌐 Ouverture du navigateur... Si rien ne s’ouvre, cliquez sur ce lien :\n')
  console.log(authUrl.toString())
  console.log('\n👉 Connectez-vous avec le compte organisateur (ex: lumine.aether.us@gmail.com) et autorisez l’accès...')

  tryOpenBrowser(authUrl.toString())
})
