#!/usr/bin/env node
/**
 * API locale pour éditer les tableaux (works) Supabase.
 * Usage : npm run works:api  →  http://127.0.0.1:47835/
 */
import http from 'node:http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const PORT = Number(process.env.WORKS_EDITOR_PORT || 47835);
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
  '/': 'works-editor.html',
  '/works-editor.html': 'works-editor.html',
  '/works-editor.js': 'works-editor.js',
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

function createSupabase() {
  const env = loadEnvFile(path.join(root, '.env'));
  const url = env.SUPABASE_URL || process.env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis dans .env');
  return createClient(url, key, { auth: { persistSession: false } });
}

function parseYear(v) {
  if (v === '' || v == null) return null;
  const n = parseInt(String(v), 10);
  if (Number.isNaN(n) || n < 1000 || n > 9999) return null;
  return n;
}

function parseCm(v) {
  if (v === '' || v == null) return null;
  const n = parseFloat(String(v).replace(',', '.'));
  if (Number.isNaN(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function normalizeWorkInput(raw) {
  const id = String(raw.id || '').trim().toUpperCase();
  if (!/^MS\d{4}$/.test(id)) throw new Error(`id invalide : ${id || '(vide)'}`);
  const seriesRaw = Array.isArray(raw.series_codes) ? raw.series_codes : [];
  const series_codes = [
    ...new Set(seriesRaw.map((c) => String(c || '').trim().toUpperCase()).filter(Boolean)),
  ];
  return {
    row: {
      id,
      title: String(raw.title || '').trim(),
      year: parseYear(raw.year),
      format_code: String(raw.format_code || '').trim().toUpperCase() || null,
      technique_code: String(raw.technique_code || '').trim().toUpperCase() || null,
      publication_status_code: String(raw.publication_status_code || 'N').trim().toUpperCase(),
      photo_status_code: String(raw.photo_status_code || 'OK').trim().toUpperCase(),
      collector_code: String(raw.collector_code || '').trim().toUpperCase() || null,
      width_cm: parseCm(raw.width_cm),
      height_cm: parseCm(raw.height_cm),
      sort_order: Number.isFinite(Number(raw.sort_order)) ? Number(raw.sort_order) : 0,
    },
    series_codes,
  };
}

async function fetchMeta(supabase) {
  const [formats, techniques, series, collectors, publication_statuses, photo_statuses] =
    await Promise.all([
      supabase
        .from('formats')
        .select('code, label, width_cm, height_cm')
        .order('sort_order')
        .order('code'),
      supabase.from('techniques').select('code, label').order('sort_order').order('code'),
      supabase.from('series').select('code, label').order('sort_order').order('code'),
      supabase.from('collectors').select('code, name').order('name'),
      supabase
        .from('publication_statuses')
        .select('code, label')
        .order('sort_order')
        .order('code'),
      supabase.from('photo_statuses').select('code, label').order('sort_order').order('code'),
    ]);
  for (const r of [formats, techniques, series, collectors, publication_statuses, photo_statuses]) {
    if (r.error) throw r.error;
  }
  return {
    formats: formats.data || [],
    techniques: techniques.data || [],
    series: series.data || [],
    collectors: (collectors.data || []).map((c) => ({
      code: c.code,
      label: c.name || c.code,
    })),
    publication_statuses: publication_statuses.data || [],
    photo_statuses: photo_statuses.data || [],
  };
}

async function fetchWorksWithSeries(supabase) {
  const { data: works, error } = await supabase
    .from('works')
    .select(
      'id, title, year, format_code, technique_code, publication_status_code, photo_status_code, collector_code, width_cm, height_cm, filename_original, image_ext, sort_order, updated_at'
    )
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw error;

  const { data: links, error: lErr } = await supabase
    .from('work_series')
    .select('work_id, series_code');
  if (lErr) throw lErr;

  const byWork = new Map();
  for (const row of links || []) {
    if (!byWork.has(row.work_id)) byWork.set(row.work_id, []);
    byWork.get(row.work_id).push(row.series_code);
  }

  return (works || []).map((w) => ({
    ...w,
    series_codes: byWork.get(w.id) || [],
  }));
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
      sendJson(res, 200, { ok: true, service: 'works-editor-api' });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/works/meta') {
      if (url.searchParams.get('token') !== TOKEN) {
        sendJson(res, 403, { ok: false, error: 'token incorrect' });
        return;
      }
      const meta = await fetchMeta(createSupabase());
      sendJson(res, 200, { ok: true, meta });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/works') {
      if (url.searchParams.get('token') !== TOKEN) {
        sendJson(res, 403, { ok: false, error: 'token incorrect' });
        return;
      }
      const works = await fetchWorksWithSeries(createSupabase());
      sendJson(res, 200, { ok: true, works });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/works/save') {
      const body = JSON.parse(await readBody(req));
      if (body.token !== TOKEN) {
        sendJson(res, 403, { ok: false, error: 'token incorrect' });
        return;
      }
      const rows = Array.isArray(body.works) ? body.works : [];
      if (!rows.length) {
        sendJson(res, 400, { ok: false, error: 'aucune œuvre à enregistrer' });
        return;
      }
      const supabase = createSupabase();
      for (const raw of rows) {
        const { row, series_codes } = normalizeWorkInput(raw);
        const { error } = await supabase.from('works').upsert(row, { onConflict: 'id' });
        if (error) throw error;
        const { error: delErr } = await supabase.from('work_series').delete().eq('work_id', row.id);
        if (delErr) throw delErr;
        if (series_codes.length) {
          const payload = series_codes.map((code) => ({
            work_id: row.id,
            series_code: code,
          }));
          const { error: insErr } = await supabase.from('work_series').insert(payload);
          if (insErr) throw insErr;
        }
      }
      const works = await fetchWorksWithSeries(supabase);
      sendJson(res, 200, { ok: true, works, saved: rows.length });
      return;
    }

    sendJson(res, 404, { ok: false, error: 'not found' });
  } catch (e) {
    console.error(e);
    sendJson(res, 500, { ok: false, error: String(e?.message || e) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.error(`works-editor-api → http://127.0.0.1:${PORT}/`);
});
