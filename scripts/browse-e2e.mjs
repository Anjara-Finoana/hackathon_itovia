#!/usr/bin/env node
import { execSync } from 'child_process';
import fs from 'fs';

const baseUrl = process.env.BASE_URL || process.env.TARGET_URL || 'http://127.0.0.1:3080';

const chromePath =
  process.env.CHROME_PATH ||
  (fs.existsSync('/home/whart/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome')
    ? '/home/whart/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome'
    : undefined);

const browseBin = fs.existsSync('/home/whart/.npm-global/bin/browse')
  ? '/home/whart/.npm-global/bin/browse'
  : 'browse';

const env = {
  ...process.env,
  PATH: `/home/whart/.npm-global/bin:${process.env.PATH}`,
  BROWSE_LOAD_DOTENV: '0',
  ...(chromePath ? { CHROME_PATH: chromePath } : {}),
};

function runBrowse(cmd, session = 'e2e-main') {
  const fullCmd = `${browseBin} ${cmd} --session ${session} ${cmd.startsWith('stop') ? '' : '--local'}`;
  try {
    const stdout = execSync(fullCmd, { env, encoding: 'utf8', timeout: 35000 });
    return { ok: true, stdout: stdout.trim() };
  } catch (err) {
    return { ok: false, error: err.message, stdout: err.stdout?.toString() || '', stderr: err.stderr?.toString() || '' };
  }
}

function runCurl(url, options = '') {
  try {
    const stdout = execSync(`curl -s ${options} "${url}"`, { encoding: 'utf8', timeout: 10000 });
    return stdout;
  } catch (err) {
    return `CURL_ERROR: ${err.message}`;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function loginAs(email, roleName, password = 'demo123') {
  const roleSession = `e2e-${roleName}`;
  runBrowse(`open ${baseUrl}/connexion`, roleSession);
  await sleep(2000);
  runBrowse(`fill "input[type=email]" "${email}"`, roleSession);
  runBrowse(`fill "input[type=password]" "${password}"`, roleSession);
  runBrowse(`click "button[type=submit]"`, roleSession);
  await sleep(2500);
  const urlRes = runBrowse(`get url`, roleSession);
  runBrowse(`stop`, roleSession);
  return {
    url: urlRes.stdout,
  };
}

async function runSuite() {
  console.log(`[E2E] Démarrage des tests navigateurs sur : ${baseUrl}`);
  let failed = 0;

  // 1. Module Public
  console.log('[E2E] Module 1: Espace Public...');
  runBrowse(`open ${baseUrl}/`);
  await sleep(1000);
  let text = runBrowse(`get markdown body`);
  if (!text.stdout?.includes('OffRec')) {
    console.error('❌ Échec test accueil OffRec');
    failed++;
  } else {
    console.log('✅ Accueil OffRec validé');
  }

  // 2. Module Auth & RBAC
  console.log('[E2E] Module 2: Authentification multi-rôles...');
  const roles = [
    { email: 'candidat@demo.mg', roleName: 'candidate', path: '/candidat' },
    { email: 'recruteur@demo.mg', roleName: 'recruiter', path: '/recruteur' },
    { email: 'particulier@demo.mg', roleName: 'particulier', path: '/particulier' },
    { email: 'agent.analamanga@demo.mg', roleName: 'agent', path: '/agent' },
    { email: 'admin@demo.mg', roleName: 'admin', path: '/admin' },
  ];

  for (const r of roles) {
    const res = await loginAs(r.email, r.roleName);
    if (!res.url?.includes(r.path)) {
      console.error(`❌ Échec connexion rôle ${r.email} vers ${r.path} (obtenu: ${res.url})`);
      failed++;
    } else {
      console.log(`✅ Connexion ${r.email} -> ${r.path} validée`);
    }
  }

  // 3. Chaos & Injection
  console.log('[E2E] Module 3: Tests de résilience & Chaos...');
  runBrowse(`open "${baseUrl}/annuaire/talents?q=%3Cscript%3Ealert(1)%3C/script%3E"`);
  await sleep(1000);
  text = runBrowse(`get markdown body`);
  if (text.stdout?.includes('<script>alert(1)</script>')) {
    console.error('❌ Faille XSS non échappée');
    failed++;
  } else {
    console.log('✅ Échappement XSS validé');
  }

  // 4. En-têtes HTTP de sécurité
  console.log('[E2E] Module 4: En-têtes de sécurité HTTP...');
  const headers = runCurl(`${baseUrl}/`, '-I');
  if (baseUrl.includes('127.0.0.1') || baseUrl.includes('localhost')) {
    if (!headers.includes('X-Frame-Options') || !headers.includes('X-Content-Type-Options')) {
      console.error('❌ En-têtes Nginx manquants');
      failed++;
    } else {
      console.log('✅ En-têtes de sécurité Nginx confirmés');
    }
  }

  runBrowse('stop');

  if (failed > 0) {
    console.error(`[E2E] Suite terminée avec ${failed} échec(s).`);
    process.exit(1);
  } else {
    console.log('[E2E] Tous les modules sont validés avec succès.');
    process.exit(0);
  }
}

runSuite().catch((err) => {
  console.error('Fatal E2E error:', err);
  process.exit(1);
});
