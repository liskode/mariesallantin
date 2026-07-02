#!/usr/bin/env node
/**
 * API locale pour éditer les ressources site public (related_media).
 * Usage : npm run resources:api  →  http://127.0.0.1:47836/
 */
import http from 'node:http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const PORT = Number(process.env.RESOURCES_EDITOR_PORT || 47836);
const TOKEN = process.env.CATALOGUE_EDITOR_TOKEN || 'MS75';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
};

const STATIC_ROUTES = {
  '/': 'resources-editor.html',
  '/resources-editor.html': 'resources-editor.html',
  '/resources-editor.js': 'resources-editor.js',
  '/editor-common.js': 'editor-common.js',
  '/catalogue.css': 'catalogue.css',
};

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

function serveStatic(res, urlPath) {
  const rel = STATIC_ROUTES[urlPath];
  if (!rel) return false;
  const filePath = path.join(root, rel);
  if (!fs.existsSync(filePath)) return false;
  const ext = path.extname(filePath).toLowerCase();
  const body = fs.readFileSync(filePath);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': body.length,
  });
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
  if (!url || !key) throw new Error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis dans .env');
  return createClient(url, key, { auth: { persistSession: false } });
}

function parseDate(v) {
  if (v === '' || v == null) return null;
  const s = String(v).trim();
  if (/^\d{4}$/.test(s)) return s + '-01-01';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

function parseDuration(v) {
  if (v === '' || v == null) return null;
  const n = parseInt(String(v), 10);
  if (Number.isNaN(n) || n <= 0) return null;
  return n;
}

function normalizeResourceInput(raw) {
  const id = String(raw.id || '').trim();
  return {
    id,
    media_type_code: String(raw.media_type_code || 'W').trim().toUpperCase(),
    title: String(raw.title || '').trim(),
    media_date: parseDate(raw.media_date),
    source: String(raw.source || '').trim(),
    description: String(raw.description || '').trim(),
    url: String(raw.url || '').trim(),
    thumbnail_path: String(raw.thumbnail_path || '').trim(),
    file_path: String(raw.file_path || '').trim(),
    internal_path: String(raw.internal_path || '').trim(),
    duration_seconds: parseDuration(raw.duration_seconds),
    publication_status_code: String(raw.publication_status_code || 'N').trim().toUpperCase(),
    sort_order: Number.isFinite(Number(raw.sort_order)) ? Number(raw.sort_order) : 0,
    is_essential: Boolean(raw.is_essential),
    series_codes: Array.isArray(raw.series_codes)
      ? [...new Set(raw.series_codes.map((c) => String(c).trim().toUpperCase()).filter(Boolean))]
      : [],
  };
}

async function syncSeriesLinks(supabase, mediaId, seriesCodes) {
  const { error: delErr } = await supabase.from('related_media_series').delete().eq('media_id', mediaId);
  if (delErr) throw delErr;
  if (!seriesCodes.length) return;
  const rows = seriesCodes.map((series_code) => ({ media_id: mediaId, series_code }));
  const { error: insErr } = await supabase.from('related_media_series').insert(rows);
  if (insErr) throw insErr;
}

async function fetchEditorPayload(supabase) {
  const [typesRes, statusesRes, seriesRes, mediaRes, seriesLinksRes] = await Promise.all([
    supabase.from('media_types').select('code, label, sort_order').order('sort_order', { ascending: true }),
    supabase.from('publication_statuses').select('code, label, sort_order').order('sort_order', { ascending: true }),
    supabase.from('series').select('code, label, sort_order').order('sort_order', { ascending: true }),
    supabase
      .from('related_media')
      .select(
        'id, media_type_code, title, media_date, source, description, url, thumbnail_path, file_path, internal_path, duration_seconds, publication_status_code, sort_order, is_essential, created_at, updated_at'
      )
      .order('sort_order', { ascending: true })
      .order('media_date', { ascending: false }),
    supabase.from('related_media_series').select('media_id, series_code'),
  ]);

  if (typesRes.error) throw typesRes.error;
  if (statusesRes.error) throw statusesRes.error;
  if (seriesRes.error) throw seriesRes.error;
  if (mediaRes.error) throw mediaRes.error;
  if (seriesLinksRes.error) throw seriesLinksRes.error;

  const seriesByMedia = new Map();
  for (const row of seriesLinksRes.data || []) {
    const id = String(row.media_id);
    if (!seriesByMedia.has(id)) seriesByMedia.set(id, []);
    seriesByMedia.get(id).push(String(row.series_code));
  }

  const items = (mediaRes.data || []).map((row) => ({
    ...row,
    series_codes: [...new Set(seriesByMedia.get(String(row.id)) || [])].sort(),
  }));

  return {
    media_types: typesRes.data || [],
    publication_statuses: statusesRes.data || [],
    series: seriesRes.data || [],
    items,
  };
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
    if (req.method === 'GET' && serveStatic(res, url.pathname)) return;

    if (req.method === 'GET' && url.pathname.startsWith('/media/')) {
      const rel = decodeURIComponent(url.pathname.slice('/media/'.length));
      if (!rel.includes('..')) {
        const filePath = path.join(root, 'media', rel);
        if (filePath.startsWith(path.join(root, 'media')) && fs.existsSync(filePath)) {
          const ext = path.extname(filePath).toLowerCase();
          const body = fs.readFileSync(filePath);
          res.writeHead(200, {
            'Content-Type': MIME[ext] || 'application/octet-stream',
            'Content-Length': body.length,
          });
          res.end(body);
          return;
        }
      }
    }

    if (req.method === 'GET' && url.pathname.startsWith('/images/')) {
      const safe = path.normalize(url.pathname).replace(/^(\.\.(\/|\\|$))+/, '');
      const filePath = path.join(root, safe);
      if (filePath.startsWith(root) && fs.existsSync(filePath)) {
        const ext = path.extname(filePath).toLowerCase();
        const body = fs.readFileSync(filePath);
        res.writeHead(200, {
          'Content-Type': MIME[ext] || 'application/octet-stream',
          'Content-Length': body.length,
        });
        res.end(body);
        return;
      }
    }

    if (req.method === 'GET' && url.pathname === '/api/health') {
      sendJson(res, 200, { ok: true, service: 'resources-editor-api' });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/resources') {
      if (url.searchParams.get('token') !== TOKEN) {
        sendJson(res, 403, { ok: false, error: 'token incorrect' });
        return;
      }
      const payload = await fetchEditorPayload(createSupabase());
      sendJson(res, 200, { ok: true, ...payload });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/resources/create') {
      const body = JSON.parse(await readBody(req));
      if (body.token !== TOKEN) {
        sendJson(res, 403, { ok: false, error: 'token incorrect' });
        return;
      }
      const supabase = createSupabase();
      const { data: last } = await supabase
        .from('related_media')
        .select('sort_order')
        .order('sort_order', { ascending: false })
        .limit(1)
        .maybeSingle();
      const sort_order = (last?.sort_order ?? 0) + 10;
      const { error } = await supabase.from('related_media').insert({
        media_type_code: 'W',
        title: 'Nouvelle ressource',
        source: '',
        description: '',
        url: '',
        thumbnail_path: '',
        file_path: '',
        internal_path: '',
        publication_status_code: 'N',
        sort_order,
      });
      if (error) throw error;
      const payload = await fetchEditorPayload(supabase);
      sendJson(res, 200, { ok: true, ...payload });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/resources/save') {
      const body = JSON.parse(await readBody(req));
      if (body.token !== TOKEN) {
        sendJson(res, 403, { ok: false, error: 'token incorrect' });
        return;
      }
      const rows = Array.isArray(body.items) ? body.items : [];
      if (!rows.length) {
        sendJson(res, 400, { ok: false, error: 'aucune ressource à enregistrer' });
        return;
      }
      const supabase = createSupabase();
      const normalized = rows.map((r) => {
        const item = normalizeResourceInput(r);
        if (!item.id) throw new Error('id manquant');
        if (!item.title) throw new Error('titre manquant pour ' + item.id);
        return item;
      });
      for (const item of normalized) {
        const { series_codes, ...row } = item;
        const { error } = await supabase.from('related_media').upsert(row, { onConflict: 'id' });
        if (error) throw error;
        await syncSeriesLinks(supabase, row.id, series_codes);
      }
      const payload = await fetchEditorPayload(supabase);
      sendJson(res, 200, { ok: true, ...payload });
      return;
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/api/resources/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/resources/'.length)).trim();
      if (url.searchParams.get('token') !== TOKEN) {
        sendJson(res, 403, { ok: false, error: 'token incorrect' });
        return;
      }
      if (!id) {
        sendJson(res, 400, { ok: false, error: 'id manquant' });
        return;
      }
      const supabase = createSupabase();
      const { error } = await supabase.from('related_media').delete().eq('id', id);
      if (error) throw error;
      const payload = await fetchEditorPayload(supabase);
      sendJson(res, 200, { ok: true, ...payload });
      return;
    }

    sendJson(res, 404, { ok: false, error: 'not found' });
  } catch (e) {
    console.error(e);
    sendJson(res, 500, { ok: false, error: String(e?.message || e) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.error(`resources-editor-api → http://127.0.0.1:${PORT}/`);
});
