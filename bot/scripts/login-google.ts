/**
 * Script de connexion assistée Google pour le bot Finoana Scribe
 *
 * Utilisation :
 *   cd bot && npx tsx scripts/login-google.ts
 * Ou depuis la racine :
 *   npm run bot:login
 *
 * 1. Ouvre Chromium en mode visible.
 * 2. Vous invite à vous connecter avec nomade.wanderer.2002@gmail.com.
 * 3. Dès la connexion réussie, capture la session (Playwright storageState)
 *    et l'enregistre dans auth/google-session.json.
 */

import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

async function main() {
  console.log('\n======================================================')
  console.log('🤖 Finoana Scribe — Authentification Google de l’Agent')
  console.log('======================================================')
  console.log('Ce script ouvre un navigateur Chromium local.')
  console.log('👉 Veuillez vous connecter avec : nomade.wanderer.2002@gmail.com\n')

  const authDir = path.resolve(process.cwd(), 'auth')
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true })
  }
  const outputFile = path.join(authDir, 'google-session.json')

  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  })

  const context = await browser.newContext({
    locale: 'fr-FR',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  })

  const page = await context.newPage()

  console.log('⏳ Ouverture de la page de connexion Google...')
  await page.goto(
    'https://accounts.google.com/ServiceLogin?service=mail&continue=https://meet.google.com',
    { waitUntil: 'domcontentloaded' }
  )

  console.log('👉 Connectez-vous dans la fenêtre du navigateur...')
  console.log('⏳ Détection automatique de la fin de connexion (attente des cookies de session)...')

  let authenticated = false
  const startTime = Date.now()
  const maxWaitMs = 5 * 60 * 1000 // 5 minutes

  while (Date.now() - startTime < maxWaitMs) {
    await page.waitForTimeout(1500)

    try {
      const cookies = await context.cookies()
      const hasSid = cookies.some((c) => c.name === 'SID' && c.domain.includes('google'))
      const currentUrl = page.url()

      if (hasSid && (currentUrl.includes('meet.google.com') || currentUrl.includes('myaccount.google.com') || currentUrl.includes('mail.google.com'))) {
        authenticated = true
        break
      }
    } catch {
      // Le navigateur a pu être fermé par l'utilisateur
      break
    }
  }

  if (!authenticated) {
    console.error('\n❌ Délai dépassé ou fenêtre fermée avant la finalisation de la connexion.')
    await browser.close().catch(() => {})
    process.exit(1)
  }

  console.log('\n✅ Connexion Google détectée avec succès !')
  await page.waitForTimeout(2000)

  const storageState = await context.storageState()
  const compactJson = JSON.stringify(storageState)
  fs.writeFileSync(outputFile, JSON.stringify(storageState, null, 2), 'utf-8')

  console.log(`📁 Fichier de session enregistré avec succès dans :`)
  console.log(`   👉 ${outputFile}`)

  await browser.close().catch(() => {})

  console.log('\n==================== COPIEZ LE JSON CI-DESSOUS ====================')
  console.log(compactJson)
  console.log('====================== FIN DU JSON ===============================')

  console.log('\n🚀 Étape suivante :')
  console.log('   Rendez-vous sur l’interface d’administration d’OffRec :')
  console.log('   👉 https://offrec.ffn-tech.com/admin/agent-ia')
  console.log('   Téléversez le fichier ou collez le JSON dans l’onglet « Coller le JSON » !')
  console.log('======================================================\n')
}

main().catch((err) => {
  console.error('Erreur critique :', err)
  process.exit(1)
})
