#!/usr/bin/env node
/**
 * API locale pour éditer le parcours artistique (artist_events).
 * Usage : npm run events:api  →  http://127.0.0.1:47837/
 */
import http from 'node:http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const PORT = Number(process.env.EVENTS_EDITOR_PORT || 47837);
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
  '/': 'events-editor.html',
  '/events-editor.html': 'events-editor.html',
  '/events-editor.js': 'events-editor.js',
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

function normalizeEventInput(raw) {
  const id = String(raw.id || '').trim();

  return {
    id,
    event_type_code: String(raw.event_type_code || 'P').trim().toUpperCase(),
    date_label: String(raw.date_label || '').trim(),
    label: String(raw.label || '').trim(),
    note: String(raw.note || '').trim(),
    publication_status_code: String(raw.publication_status_code || 'N').trim().toUpperCase(),
    sort_order: Number.isFinite(Number(raw.sort_order)) ? Number(raw.sort_order) : 0,
    media_ids: Array.isArray(raw.media_ids)
      ? [...new Set(raw.media_ids.map((m) => String(m).trim()).filter(Boolean))]
      : [],
  };
}

async function syncMediaLinks(supabase, eventId, mediaIds) {
  const { error: delErr } = await supabase.from('artist_event_media').delete().eq('event_id', eventId);
  if (delErr) throw delErr;
  if (!mediaIds.length) return;
  const rows = mediaIds.map((media_id) => ({ event_id: eventId, media_id }));
  const { error: insErr } = await supabase.from('artist_event_media').insert(rows);
  if (insErr) throw insErr;
}

async function fetchEditorPayload(supabase) {
  const [typesRes, statusesRes, eventsRes, linksRes, mediaRes] = await Promise.all([
    supabase.from('event_types').select('code, label, sort_order').order('sort_order', { ascending: true }),
    supabase.from('publication_statuses').select('code, label, sort_order').order('sort_order', { ascending: true }),
    supabase
      .from('artist_events')
      .select(
        'id, event_type_code, date_label, label, note, publication_status_code, sort_order, created_at, updated_at'
      )
      .order('sort_order', { ascending: true }),
    supabase.from('artist_event_media').select('event_id, media_id'),
    supabase
      .from('related_media')
      .select('id, title, media_type_code, publication_status_code')
      .order('sort_order', { ascending: true })
      .order('title', { ascending: true }),
  ]);

  if (typesRes.error) throw typesRes.error;
  if (statusesRes.error) throw statusesRes.error;
  if (eventsRes.error) throw eventsRes.error;
  if (linksRes.error) throw linksRes.error;
  if (mediaRes.error) throw mediaRes.error;

  const mediaByEvent = new Map();
  for (const row of linksRes.data || []) {
    const eventId = String(row.event_id);
    const list = mediaByEvent.get(eventId) || [];
    list.push(String(row.media_id));
    mediaByEvent.set(eventId, list);
  }

  const items = (eventsRes.data || []).map((row) => ({
    ...row,
    media_ids: [...new Set(mediaByEvent.get(String(row.id)) || [])].sort(),
  }));

  return {
    event_types: typesRes.data || [],
    publication_statuses: statusesRes.data || [],
    media_options: mediaRes.data || [],
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
      sendJson(res, 200, { ok: true, service: 'events-editor-api' });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/events') {
      if (url.searchParams.get('token') !== TOKEN) {
        sendJson(res, 403, { ok: false, error: 'token incorrect' });
        return;
      }
      const payload = await fetchEditorPayload(createSupabase());
      sendJson(res, 200, { ok: true, ...payload });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/events/create') {
      const body = JSON.parse(await readBody(req));
      if (body.token !== TOKEN) {
        sendJson(res, 403, { ok: false, error: 'token incorrect' });
        return;
      }
      const supabase = createSupabase();
      const { data: last } = await supabase
        .from('artist_events')
        .select('sort_order')
        .order('sort_order', { ascending: false })
        .limit(1)
        .maybeSingle();
      const sort_order = (last?.sort_order ?? 0) + 10;
      const year = new Date().getFullYear();
      const { error } = await supabase.from('artist_events').insert({
        event_type_code: 'P',
        date_label: String(year),
        label: 'Nouvel événement',
        note: '',
        publication_status_code: 'N',
        sort_order,
      });
      if (error) throw error;
      const payload = await fetchEditorPayload(supabase);
      sendJson(res, 200, { ok: true, ...payload });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/events/save') {
      const body = JSON.parse(await readBody(req));
      if (body.token !== TOKEN) {
        sendJson(res, 403, { ok: false, error: 'token incorrect' });
        return;
      }
      const rows = Array.isArray(body.items) ? body.items : [];
      if (!rows.length) {
        sendJson(res, 400, { ok: false, error: 'aucun événement à enregistrer' });
        return;
      }
      const supabase = createSupabase();
      const normalized = rows.map((r) => {
        const item = normalizeEventInput(r);
        if (!item.id) throw new Error('id manquant');
        if (!item.date_label) throw new Error('date affichée manquante pour ' + item.id);
        if (!item.label) throw new Error('libellé manquant pour ' + item.id);
        return item;
      });
      for (const item of normalized) {
        const { media_ids, ...row } = item;
        const { error } = await supabase.from('artist_events').upsert(row, { onConflict: 'id' });
        if (error) throw error;
        await syncMediaLinks(supabase, row.id, media_ids);
      }
      const payload = await fetchEditorPayload(supabase);
      sendJson(res, 200, { ok: true, ...payload });
      return;
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/api/events/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/events/'.length)).trim();
      if (url.searchParams.get('token') !== TOKEN) {
        sendJson(res, 403, { ok: false, error: 'token incorrect' });
        return;
      }
      if (!id) {
        sendJson(res, 400, { ok: false, error: 'id manquant' });
        return;
      }
      const supabase = createSupabase();
      const { error } = await supabase.from('artist_events').delete().eq('id', id);
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
  console.error(`events-editor-api → http://127.0.0.1:${PORT}/`);
});
