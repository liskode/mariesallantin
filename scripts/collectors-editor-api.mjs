#!/usr/bin/env node
/**
 * API locale pour éditer les collectionneurs Supabase (lecture/écriture via service role).
 *
 * Usage :
 *   node scripts/collectors-editor-api.mjs
 *   npm run collectors:api
 *
 * Variables (.env) :
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   COLLECTORS_EDITOR_PORT  (défaut 47832)
 *   CATALOGUE_EDITOR_TOKEN  (défaut MS75)
 */

import http from 'node:http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { nextCollectorCode } from './collector-utils.mjs';
import { loadWorkMediaById, resolveMediaRelativePath, workImageUrls } from './media-thumb-urls.mjs';
import {
  ROLES,
  authFromRequest,
  bootstrapEditorEnv,
  handleLoginRoute,
  handleSessionRoute,
} from './local-api-auth.mjs';
import { logEditorAction } from './audit-log.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const PORT = Number(process.env.COLLECTORS_EDITOR_PORT || 47832);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

const STATIC_ROUTES = {
  '/': 'collectors.html',
  '/collectors.html': 'collectors.html',
  '/collectors.js': 'collectors.js',
  '/editor-common.js': 'editor-common.js',
  '/catalogue.css': 'catalogue.css',
};

const COLLECTOR_TYPES = new Set(['Galerie', 'Institutions', 'Particulier']);

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return {};
  const out = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

bootstrapEditorEnv(root, loadEnvFile);

function serveStatic(res, urlPath) {
  const rel = STATIC_ROUTES[urlPath];
  if (!rel) return false;
  const filePath = path.join(root, rel);
  if (!filePath.startsWith(root) || !fs.existsSync(filePath)) return false;
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const body = fs.readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length });
  res.end(body);
  return true;
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
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

function createSupabase() {
  const env = loadEnvFile(path.join(root, '.env'));
  const url = env.SUPABASE_URL || process.env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis dans .env');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function normalizeCollectorInput(raw) {
  const code = String(raw.code || '').trim();
  const name = String(raw.name || '').trim();
  const collector_type = COLLECTOR_TYPES.has(raw.collector_type)
    ? raw.collector_type
    : 'Particulier';
  return {
    code,
    name,
    collector_type,
    first_name: String(raw.first_name || '').trim(),
    phone: String(raw.phone || '').trim(),
    email: String(raw.email || '').trim(),
    notes: String(raw.notes || '').trim(),
  };
}

async function fetchCollectorsWithCounts(supabase) {
  const mediaRoot = path.join(root, 'media');
  const mediaById = loadWorkMediaById(path.join(mediaRoot, 'works.json'));

  const { data: collectors, error } = await supabase
    .from('collectors')
    .select('code, name, collector_type, first_name, phone, email, notes, created_at, updated_at')
    .order('name', { ascending: true });

  if (error) throw error;

  const { data: works, error: wErr } = await supabase
    .from('works')
    .select('id, title, collector_code')
    .not('collector_code', 'is', null)
    .order('id', { ascending: true });

  if (wErr) throw wErr;

  /** @type {Map<string, object[]>} */
  const worksByCollector = new Map();
  for (const row of works || []) {
    const code = row.collector_code;
    if (!worksByCollector.has(code)) worksByCollector.set(code, []);
    const mediaFp = mediaById.get(row.id) || '';
    const { thumb_url, full_url } = workImageUrls(mediaFp, mediaRoot);
    worksByCollector.get(code).push({
      id: row.id,
      title: String(row.title || '').trim(),
      thumb_url,
      full_url,
    });
  }

  return (collectors || []).map((c) => {
    const list = worksByCollector.get(c.code) || [];
    return {
      ...c,
      work_count: list.length,
      works: list,
    };
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);

  try {
    if (req.method === 'GET' && serveStatic(res, url.pathname)) {
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/media/')) {
      const rel = decodeURIComponent(url.pathname.slice('/media/'.length));
      const mediaDir = path.join(root, 'media');
      const resolved = resolveMediaRelativePath(mediaDir, rel);
      if (resolved) {
        const filePath = path.join(mediaDir, resolved);
        const ext = path.extname(filePath).toLowerCase();
        const type = MIME[ext] || 'application/octet-stream';
        const body = fs.readFileSync(filePath);
        res.writeHead(200, {
          'Content-Type': type,
          'Content-Length': body.length,
          'Cache-Control': 'public, max-age=300',
        });
        res.end(body);
        return;
      }
    }

    if (req.method === 'GET' && url.pathname.startsWith('/images/')) {
      const safe = path.normalize(url.pathname).replace(/^(\.\.(\/|\\|$))+/, '');
      const filePath = path.join(root, safe);
      if (filePath.startsWith(root) && fs.existsSync(filePath)) {
        const ext = path.extname(filePath).toLowerCase();
        const type = MIME[ext] || 'application/octet-stream';
        const body = fs.readFileSync(filePath);
        res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length });
        res.end(body);
        return;
      }
    }

    if (req.method === 'GET' && url.pathname === '/api/health') {
      sendJson(res, 200, { ok: true, service: 'collectors-editor-api' });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/login') {
      const body = JSON.parse(await readBody(req));
      const result = handleLoginRoute(body);
      if (!result.ok) {
        sendJson(res, result.status, { ok: false, error: result.error });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        token: result.token,
        role: result.role,
        expiresAt: result.expiresAt,
        expiresIn: result.expiresIn,
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/session') {
      const result = handleSessionRoute(req, url);
      if (!result.ok) {
        sendJson(res, result.status, { ok: false, error: result.error });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        role: result.role,
        expiresAt: result.expiresAt,
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/collectors') {
      if (!authFromRequest(req, url, null, ROLES.ARTIST)) {
        sendJson(res, 403, { ok: false, error: 'session invalide ou expirée' });
        return;
      }
      const supabase = createSupabase();
      const collectors = await fetchCollectorsWithCounts(supabase);
      sendJson(res, 200, { ok: true, collectors });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/collectors/save') {
      const raw = await readBody(req);
      const body = JSON.parse(raw);
      const auth = authFromRequest(req, url, body, ROLES.ARTIST);
      if (!auth) {
        sendJson(res, 403, { ok: false, error: 'session invalide ou expirée' });
        return;
      }
      const rows = Array.isArray(body.collectors) ? body.collectors : [];
      if (!rows.length) {
        sendJson(res, 400, { ok: false, error: 'aucun collectionneur à enregistrer' });
        return;
      }

      const supabase = createSupabase();
      for (const r of rows) {
        const c = normalizeCollectorInput(r);
        if (!c.code) throw new Error('code manquant');
        if (!c.name) throw new Error(`nom manquant pour ${c.code}`);
        const { data: before } = await supabase
          .from('collectors')
          .select('*')
          .eq('code', c.code)
          .maybeSingle();
        const { error } = await supabase.from('collectors').upsert(c, { onConflict: 'code' });
        if (error) throw error;
        await logEditorAction(supabase, {
          editor_role: auth.role,
          action_type: 'save',
          entity_type: 'collector',
          entity_key: c.code,
          snapshot_before: before || null,
        });
      }

      const collectors = await fetchCollectorsWithCounts(supabase);
      sendJson(res, 200, { ok: true, collectors });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/collectors/create') {
      const raw = await readBody(req);
      const body = JSON.parse(raw);
      const auth = authFromRequest(req, url, body, ROLES.ARTIST);
      if (!auth) {
        sendJson(res, 403, { ok: false, error: 'session invalide ou expirée' });
        return;
      }

      const c = normalizeCollectorInput(body.collector || {});
      if (!c.name) {
        sendJson(res, 400, { ok: false, error: 'nom requis' });
        return;
      }

      const supabase = createSupabase();
      const code = await nextCollectorCode(supabase);
      const row = { ...c, code };
      const { error } = await supabase.from('collectors').insert(row);
      if (error) {
        sendJson(res, 400, { ok: false, error: error.message });
        return;
      }
      await logEditorAction(supabase, {
        editor_role: auth.role,
        action_type: 'save',
        entity_type: 'collector',
        entity_key: code,
        snapshot_before: null,
      });

      const collectors = await fetchCollectorsWithCounts(supabase);
      sendJson(res, 200, { ok: true, collector: row, collectors });
      return;
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/api/collectors/')) {
      const code = decodeURIComponent(url.pathname.slice('/api/collectors/'.length));
      const auth = authFromRequest(req, url, null, ROLES.ADMIN);
      if (!auth) {
        sendJson(res, 403, { ok: false, error: 'accès réservé aux administrateurs' });
        return;
      }
      if (!code) {
        sendJson(res, 400, { ok: false, error: 'code manquant' });
        return;
      }

      const supabase = createSupabase();
      const { data: before } = await supabase.from('collectors').select('*').eq('code', code).maybeSingle();
      const { count, error: cErr } = await supabase
        .from('works')
        .select('id', { count: 'exact', head: true })
        .eq('collector_code', code);
      if (cErr) throw cErr;
      if ((count || 0) > 0) {
        sendJson(res, 400, {
          ok: false,
          error: `impossible de supprimer ${code} : ${count} œuvre(s) liée(s)`,
        });
        return;
      }

      const { error } = await supabase.from('collectors').delete().eq('code', code);
      if (error) throw error;
      await logEditorAction(supabase, {
        editor_role: auth.role,
        action_type: 'delete',
        entity_type: 'collector',
        entity_key: code,
        snapshot_before: before || null,
      });

      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 404, { ok: false, error: 'not found' });
  } catch (e) {
    console.error(e);
    sendJson(res, 500, { ok: false, error: String(e?.message || e) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.error(`collectors-editor-api → http://127.0.0.1:${PORT}/`);
  console.error('Ouvrez cette URL dans le navigateur (page + API + vignettes media/).');
});
