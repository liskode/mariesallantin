#!/usr/bin/env node
/**
 * Page de tri d'un export de photothèque (studio local).
 *
 * Usage : npm run export:tri -- <dossier_export>
 *         puis http://127.0.0.1:47840/
 *
 * Lit <dossier_export>/_baseart/triage.json (voir export-triage-build.mjs) et enregistre
 * les décisions dans <dossier_export>/_baseart/decisions.json à chaque clic.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { fetchAll } from './supabase-fetch-all.mjs';
import { extractMsIdFromFilename } from './work-import.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.EXPORT_TRIAGE_PORT || 47840);
const exportDir = path.resolve(process.argv[2] || '');
const workDir = path.join(exportDir, '_baseart');
const triagePath = path.join(workDir, 'triage.json');
const decisionsPath = path.join(workDir, 'decisions.json');
const appDir = path.join(root, 'scripts', 'triage');
if (!process.argv[2] || !fs.existsSync(triagePath)) {
  console.error('Usage : npm run export:tri -- <dossier_export>  (triage.json introuvable)');
  process.exit(1);
}

function loadEnvFile(envPath) {
  const out = {};
  if (!fs.existsSync(envPath)) return out;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    const eq = t.indexOf('=');
    if (!t || t.startsWith('#') || eq < 0) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}
const env = loadEnvFile(path.join(root, '.env'));
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const catalogueDir = path.join(root, 'media', 'catalogue');
function catalogueFiles() {
  const thumbs = new Map();
  const full = new Map();
  for (const name of fs.readdirSync(path.join(catalogueDir, '_thumbs'))) {
    const id = extractMsIdFromFilename(name);
    if (id) thumbs.set(id, path.join(catalogueDir, '_thumbs', name));
  }
  for (const name of fs.readdirSync(catalogueDir)) {
    const id = extractMsIdFromFilename(name);
    if (id) full.set(id, path.join(catalogueDir, name));
  }
  return { thumbs, full };
}
let catalogue = catalogueFiles();

function readDecisions() {
  try {
    return JSON.parse(fs.readFileSync(decisionsPath, 'utf8'));
  } catch {
    return {};
  }
}
function writeDecisions(d) {
  const tmp = decisionsPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(d, null, 1));
  fs.renameSync(tmp, decisionsPath);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.png': 'image/png',
};
function sendFile(res, file) {
  if (!file || !fs.existsSync(file)) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'max-age=3600',
  });
  fs.createReadStream(file).pipe(res);
}
function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}
/** Le chemin demandé doit rester dans le dossier autorisé. */
function inside(dir, rel) {
  const abs = path.resolve(dir, rel);
  return abs.startsWith(path.resolve(dir) + path.sep) ? abs : null;
}

const DECISION_KEYS = new Set(['category', 'work', 'replace', 'best', 'situ_works', 'situ_type', 'caption']);
const CATEGORIES = new Set(['duplicate', 'new', 'situ', 'ignore']);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
  try {
    if (req.method === 'GET') {
      if (url.pathname === '/') return sendFile(res, path.join(appDir, 'index.html'));
      if (/^\/(app\.js|style\.css)$/.test(url.pathname)) return sendFile(res, path.join(appDir, url.pathname.slice(1)));
      if (url.pathname.startsWith('/th/')) return sendFile(res, inside(path.join(workDir, 'th'), url.pathname.slice(4)));
      if (url.pathname === '/photo') return sendFile(res, inside(exportDir, url.searchParams.get('name') || ''));
      if (url.pathname.startsWith('/cat/')) {
        const id = url.pathname.slice(5).toUpperCase();
        return sendFile(res, catalogue.thumbs.get(id) || catalogue.full.get(id));
      }
      if (url.pathname === '/api/data') {
        const triage = JSON.parse(fs.readFileSync(triagePath, 'utf8'));
        const works = await fetchAll((f, t) =>
          supabase.from('works').select('id, title, year, image_quality').order('id').range(f, t)
        );
        return sendJson(res, 200, { ok: true, triage, decisions: readDecisions(), works });
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/decision') {
      // En-tête personnalisé : bloque les requêtes envoyées par d'autres sites (pré-vérification CORS refusée)
      if (req.headers['x-baseart'] !== '1') return sendJson(res, 403, { ok: false, error: 'requête refusée' });
      const body = JSON.parse(await readBody(req));
      const group = String(body.group || '');
      if (!/^g\d{4}$/.test(group)) return sendJson(res, 400, { ok: false, error: 'groupe invalide' });
      const patch = {};
      for (const [k, v] of Object.entries(body.decision || {})) if (DECISION_KEYS.has(k)) patch[k] = v;
      if (patch.category && !CATEGORIES.has(patch.category)) return sendJson(res, 400, { ok: false, error: 'catégorie invalide' });
      const all = readDecisions();
      all[group] = { ...(all[group] || {}), ...patch, at: new Date().toISOString() };
      writeDecisions(all);
      return sendJson(res, 200, { ok: true, decision: all[group] });
    }
    sendJson(res, 404, { ok: false, error: 'not found' });
  } catch (e) {
    console.error(e);
    sendJson(res, 500, { ok: false, error: String(e?.message || e) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.error(`Tri de l'export → http://127.0.0.1:${PORT}/  (${exportDir})`);
});
