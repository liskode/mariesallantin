#!/usr/bin/env node
/**
 * Studio d'import œuvres : démarre l'API locale et ouvre l'éditeur.
 * Usage : npm run works:import
 */
import { spawn, execFileSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const PORT = Number(process.env.WORKS_EDITOR_PORT || 47835);
const URL = `http://127.0.0.1:${PORT}/`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.end();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.setTimeout(400, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function fetchApiHealth() {
  try {
    const r = await fetch(`${URL}api/health`, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function killProcessOnPort(port) {
  try {
    if (process.platform === 'win32') {
      execFileSync(
        'cmd',
        ['/c', `for /f "tokens=5" %a in ('netstat -ano ^| findstr :${port}') do taskkill /F /PID %a`],
        { stdio: 'ignore' }
      );
    } else {
      execFileSync('sh', ['-c', `lsof -ti:${port} | xargs kill -9 2>/dev/null || true`], {
        stdio: 'ignore',
      });
    }
  } catch {
    /* port déjà libre */
  }
}

async function startApiServer() {
  const child = spawn(process.execPath, ['scripts/works-editor-api.mjs'], {
    cwd: root,
    stdio: 'inherit',
    detached: true,
  });
  child.unref();
  for (let i = 0; i < 25; i++) {
    await sleep(200);
    const health = await fetchApiHealth();
    if (health?.ok && health?.features?.publish) return true;
  }
  return false;
}

async function ensureApiWithPublish() {
  const health = await fetchApiHealth();
  if (health?.ok && health?.features?.publish) return;

  if (await portOpen(PORT)) {
    console.error('API locale obsolète (sans publication git) — redémarrage…');
    killProcessOnPort(PORT);
    await sleep(600);
  }

  console.error('Démarrage works-editor-api…');
  const ok = await startApiServer();
  if (!ok) {
    throw new Error(
      `Impossible de démarrer l'API sur le port ${PORT}. Arrêtez l'ancien terminal (Ctrl+C) puis relancez npm run works:import`
    );
  }
}

function openBrowser(url) {
  const platform = process.platform;
  try {
    if (platform === 'darwin') {
      execFileSync('open', [url], { stdio: 'ignore' });
    } else if (platform === 'win32') {
      execFileSync('cmd', ['/c', 'start', '', url], { stdio: 'ignore' });
    } else {
      execFileSync('xdg-open', [url], { stdio: 'ignore' });
    }
  } catch {
    /* navigateur non disponible */
  }
}

async function main() {
  await ensureApiWithPublish();

  console.log('');
  console.log('Studio import œuvres');
  console.log('────────────────────');
  console.log(URL);
  console.log('');
  console.log('1. Choisir les images et vérifier / corriger format, technique, série');
  console.log('2. Importer puis publier sur mariesallantin.art (git push automatique)');
  console.log('');
  console.log('Secours publication : npm run works:publish');
  console.log('');

  openBrowser(URL);
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
