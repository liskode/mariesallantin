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
  const running = await portOpen(PORT);
  if (!running) {
    const child = spawn(process.execPath, ['scripts/works-editor-api.mjs'], {
      cwd: root,
      stdio: 'inherit',
      detached: true,
    });
    child.unref();
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 200));
      if (await portOpen(PORT)) break;
    }
  }

  console.log('');
  console.log('Studio import œuvres');
  console.log('────────────────────');
  console.log(URL);
  console.log('');
  console.log('1. Choisir les images et vérifier / corriger format, technique, série');
  console.log('2. Importer puis publier sur mariesallantin.art (git push automatique)');
  console.log('');

  openBrowser(URL);
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
