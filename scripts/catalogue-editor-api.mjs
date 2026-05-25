#!/usr/bin/env node
/**
 * API locale pour enregistrer l’édition catalogue sur le disque (works.json,
 * catalog-state.json, renommages dans media/catalogue/).
 *
 * Usage (depuis la racine du dépôt) :
 *   node scripts/catalogue-editor-api.mjs
 *
 * Variables optionnelles :
 *   CATALOGUE_EDITOR_PORT   (défaut 47831)
 *   CATALOGUE_EDITOR_TOKEN  (défaut MS75 — même mot de passe que la page)
 *
 * Dans catalogue-legende.html, l’URL doit correspondre (meta catalogue-save-api).
 * L’éditeur catalogue-legende-app.mjs appelle POST /api/save après chaque modification (debounce).
 */

import http from 'node:http';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const catalogueDir = path.join(root, 'media', 'catalogue');
const worksPath = path.join(root, 'media', 'works.json');
const statePath = path.join(root, 'media', 'catalog-state.json');

const PORT = Number(process.env.CATALOGUE_EDITOR_PORT || 47831);
const TOKEN = process.env.CATALOGUE_EDITOR_TOKEN || 'MS75';

/** @param {string} name */
function safeCatalogueBasename(name) {
  const b = path.basename(String(name || ''));
  if (!b || b !== String(name).trim()) throw new Error('nom de fichier invalide');
  if (b.includes('..') || /[/\\]/.test(name)) throw new Error('nom de fichier refusé');
  return b;
}

async function atomicWriteJson(filePath, obj) {
  const tmp = filePath + '.tmp.' + process.pid;
  const text = JSON.stringify(obj, null, 2) + '\n';
  await fs.writeFile(tmp, text, 'utf8');
  await fs.rename(tmp, filePath);
}

/**
 * @param {Array<{ from: string, to: string }>} renames
 */
async function applyRenames(renames) {
  for (const r of renames) {
    const from = safeCatalogueBasename(r.from);
    const to = safeCatalogueBasename(r.to);
    if (from === to) continue;
    const fpFrom = path.join(catalogueDir, from);
    const fpTo = path.join(catalogueDir, to);
    try {
      await fs.access(fpFrom);
    } catch {
      throw new Error(`fichier catalogue introuvable : ${from}`);
    }
    await fs.rename(fpFrom, fpTo);
  }
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/api/health') {
    sendJson(res, 200, { ok: true, service: 'catalogue-editor-api', root });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/save') {
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw);
      if (body.token !== TOKEN) {
        sendJson(res, 403, { ok: false, error: 'token incorrect' });
        return;
      }
      const renames = Array.isArray(body.renames) ? body.renames : [];
      const works = body.works;
      if (!works || typeof works !== 'object') {
        sendJson(res, 400, { ok: false, error: 'champ works manquant' });
        return;
      }
      await applyRenames(renames);
      await atomicWriteJson(worksPath, works);
      if (body.catalogState != null && typeof body.catalogState === 'object' && !Array.isArray(body.catalogState)) {
        await atomicWriteJson(statePath, body.catalogState);
      }
      sendJson(res, 200, { ok: true });
    } catch (e) {
      console.error(e);
      sendJson(res, 500, { ok: false, error: String(e && e.message ? e.message : e) });
    }
    return;
  }

  sendJson(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.error(`catalogue-editor-api écoute http://127.0.0.1:${PORT} (racine ${root})`);
});
