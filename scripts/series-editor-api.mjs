#!/usr/bin/env node
/**
 * API locale pour éditer les séries Supabase (service role).
 * Usage : npm run series:api  →  http://127.0.0.1:47833/
 */
import http from 'node:http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const PORT = Number(process.env.SERIES_EDITOR_PORT || 47833);
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
  '/': 'series.html',
  '/series.html': 'series.html',
  '/series.js': 'series.js',
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
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': body.length });
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

function normalizeSeriesInput(raw) {
  const code = String(raw.code || '').trim().toUpperCase();
  const label = String(raw.label || '').trim();
  let icon = String(raw.icon_work_id || '').trim().toUpperCase();
  if (icon && !/^MS\d{4}$/.test(icon)) icon = '';
  const parseYear = (v) => {
    if (v === '' || v == null) return null;
    const n = parseInt(String(v), 10);
    return Number.isNaN(n) || n < 1000 || n > 9999 ? null : n;
  };
  return {
    code,
    label,
    icon_work_id: icon || null,
    year_start: parseYear(raw.year_start),
    year_end: parseYear(raw.year_end),
    description: String(raw.description || ''),
    sort_order: Number.isFinite(Number(raw.sort_order)) ? Number(raw.sort_order) : 0,
  };
}

async function fetchSeriesWithCounts(supabase) {
  const { data: series, error } = await supabase
    .from('series')
    .select('code, label, sort_order, icon_work_id, year_start, year_end, description, created_at, updated_at')
    .order('sort_order', { ascending: true })
    .order('code', { ascending: true });
  if (error) throw error;

  const { data: links, error: lErr } = await supabase.from('work_series').select('series_code');
  if (lErr) throw lErr;

  const counts = new Map();
  for (const row of links || []) {
    counts.set(row.series_code, (counts.get(row.series_code) || 0) + 1);
  }

  return (series || []).map((s) => ({
    ...s,
    work_count: counts.get(s.code) || 0,
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
          res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': body.length });
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
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': body.length });
        res.end(body);
        return;
      }
    }

    if (req.method === 'GET' && url.pathname === '/api/health') {
      sendJson(res, 200, { ok: true, service: 'series-editor-api' });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/series') {
      if (url.searchParams.get('token') !== TOKEN) {
        sendJson(res, 403, { ok: false, error: 'token incorrect' });
        return;
      }
      const series = await fetchSeriesWithCounts(createSupabase());
      sendJson(res, 200, { ok: true, series });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/series/save') {
      const body = JSON.parse(await readBody(req));
      if (body.token !== TOKEN) {
        sendJson(res, 403, { ok: false, error: 'token incorrect' });
        return;
      }
      const rows = Array.isArray(body.series) ? body.series : [];
      if (!rows.length) {
        sendJson(res, 400, { ok: false, error: 'aucune série à enregistrer' });
        return;
      }
      const supabase = createSupabase();
      const payload = rows.map((r) => {
        const s = normalizeSeriesInput(r);
        if (!s.code) throw new Error('code manquant');
        return s;
      });
      const { error } = await supabase.from('series').upsert(payload, { onConflict: 'code' });
      if (error) throw error;
      const series = await fetchSeriesWithCounts(supabase);
      sendJson(res, 200, { ok: true, series });
      return;
    }

    sendJson(res, 404, { ok: false, error: 'not found' });
  } catch (e) {
    console.error(e);
    sendJson(res, 500, { ok: false, error: String(e?.message || e) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.error(`series-editor-api → http://127.0.0.1:${PORT}/`);
});
