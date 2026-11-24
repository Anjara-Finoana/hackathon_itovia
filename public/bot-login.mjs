/**
 * Script autonome de connexion Google pour Finoana Scribe (OffRec)
 * Exécutable sans cloner le dépôt :
 *   Linux/macOS : curl -sSL https://offrec.ffn-tech.com/bot-login.mjs -o /tmp/offrec-bot-login.mjs && node /tmp/offrec-bot-login.mjs
 *   Windows PS  : irm https://offrec.ffn-tech.com/bot-login.mjs -OutFile $env:TEMP\offrec-bot-login.mjs; node $env:TEMP\offrec-bot-login.mjs
 */

import { execSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

function findSystemBrowser() {
  const platform = os.platform()
  const candidates =
    platform === 'darwin'
      ? [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Chromium.app/Contents/MacOS/Chromium',
          '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        ]
      : platform === 'win32'
        ? [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
            'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
          ]
        : [
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
            '/snap/bin/chromium',
            '/usr/bin/microsoft-edge',
          ]

  return candidates.find((p) => fs.existsSync(p)) || null
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
    // stdio ignore sur stdout/stderr + timeout : xclip/wl-copy forke en arrière-plan
    // et bloquerait spawnSync indéfiniment si les pipes restaient ouverts.
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

function ensurePlaywright(workDir) {
  fs.mkdirSync(workDir, { recursive: true })
  const pkgPath = path.join(workDir, 'package.json')
  if (!fs.existsSync(pkgPath)) {
    fs.writeFileSync(pkgPath, JSON.stringify({ name: 'offrec-bot-auth-tmp', private: true }), 'utf-8')
  }

  const pwDir = path.join(workDir, 'node_modules', 'playwright')
  if (!fs.existsSync(pwDir)) {
    console.log('📦 Installation temporaire de Playwright (quelques secondes)...')
    execSync('npm install --no-save --silent playwright', {
      cwd: workDir,
      stdio: 'inherit',
    })
  }

  const require = createRequire(pkgPath)
  return require('playwright')
}

async function main() {
  console.log('\n==============================================================')
  console.log('🤖 OffRec — Générateur de session Google (Finoana Scribe)')
  console.log('==============================================================')

  const workDir = path.join(os.tmpdir(), 'offrec-bot-auth')
  const { chromium } = ensurePlaywright(workDir)

  const systemBrowser = findSystemBrowser()
  let browser

  if (systemBrowser) {
    console.log(`🌐 Navigateur détecté : ${systemBrowser}`)
    try {
      browser = await chromium.launch({
        headless: false,
        executablePath: systemBrowser,
        args: ['--disable-blink-features=AutomationControlled'],
      })
    } catch {
      browser = null
    }
  }

  if (!browser) {
    console.log('📥 Téléchargement du navigateur Chromium Playwright...')
    execSync('npx playwright install chromium', { cwd: workDir, stdio: 'inherit' })
    browser = await chromium.launch({
      headless: false,
      args: ['--disable-blink-features=AutomationControlled'],
    })
  }

  const context = await browser.newContext({
    locale: 'fr-FR',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  })

  const page = await context.newPage()
  console.log('👉 Connectez-vous avec le compte Google du bot (ex: nomade.wanderer.2002@gmail.com) dans la fenêtre...')

  await page.goto('https://accounts.google.com/ServiceLogin?service=mail&continue=https://meet.google.com', {
    waitUntil: 'domcontentloaded',
  })

  let authenticated = false
  const startTime = Date.now()
  const maxWaitMs = 5 * 60 * 1000

  while (Date.now() - startTime < maxWaitMs) {
    await page.waitForTimeout(1500)
    try {
      const cookies = await context.cookies()
      const hasSid = cookies.some((c) => c.name === 'SID' && c.domain.includes('google'))
      const url = page.url()
      if (
        hasSid &&
        (url.includes('meet.google.com') || url.includes('myaccount.google.com') || url.includes('mail.google.com'))
      ) {
        authenticated = true
        break
      }
    } catch {
      break
    }
  }

  if (!authenticated) {
    console.error('\n❌ Connexion annulée ou délai dépassé (5 min).')
    await browser.close().catch(() => {})
    process.exit(1)
  }

  await page.waitForTimeout(2000)
  const storageState = await context.storageState()
  await browser.close().catch(() => {})

  const compactJson = JSON.stringify(storageState)
  const prettyJson = JSON.stringify(storageState, null, 2)

  let savedFile = null
  try {
    const outPath = path.resolve(process.cwd(), 'google-session.json')
    fs.writeFileSync(outPath, prettyJson, 'utf-8')
    savedFile = outPath
  } catch {
    // Ignore si le dossier courant n'est pas accessible en écriture
  }

  console.log('\n✅ Session Google capturée avec succès !')
  if (savedFile) {
    console.log(`📁 Fichier enregistré : ${savedFile}`)
  }
  console.log('\n==================== COPIEZ LE JSON CI-DESSOUS ====================')
  console.log(compactJson)
  console.log('====================== FIN DU JSON ===============================')

  const copied = tryCopyToClipboard(compactJson)
  if (copied) {
    console.log('📋 Le JSON a également été copié dans votre presse-papier !')
  }
  console.log('\n👉 Retournez sur /admin/agent-ia dans OffRec, onglet « Coller le JSON », collez et enregistrez.\n')
  process.exit(0)
}

main().catch((err) => {
  console.error('❌ Erreur :', err)
  process.exit(1)
})
