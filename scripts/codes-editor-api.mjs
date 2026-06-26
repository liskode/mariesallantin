#!/usr/bin/env node
/**
 * API locale pour éditer formats et techniques Supabase.
 * Usage : npm run codes:api  →  http://127.0.0.1:47834/
 */
import http from 'node:http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const PORT = Number(process.env.CODES_EDITOR_PORT || 47834);
const TOKEN = process.env.CATALOGUE_EDITOR_TOKEN || 'MS75';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
};

const STATIC_ROUTES = {
  '/': 'codes-editor.html',
  '/codes-editor.html': 'codes-editor.html',
  '/codes-editor.js': 'codes-editor.js',
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

function parseCm(v) {
  if (v === '' || v == null) return null;
  const n = parseFloat(String(v).replace(',', '.'));
  if (Number.isNaN(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function normalizeFormatInput(raw) {
  const code = String(raw.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(code)) throw new Error(`code format invalide : ${code || '(vide)'}`);
  return {
    code,
    label: String(raw.label || '').trim(),
    width_cm: parseCm(raw.width_cm),
    height_cm: parseCm(raw.height_cm),
    sort_order: Number.isFinite(Number(raw.sort_order)) ? Number(raw.sort_order) : 0,
  };
}

function normalizeTechniqueInput(raw) {
  const code = String(raw.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{3}$/.test(code)) throw new Error(`code technique invalide : ${code || '(vide)'}`);
  return {
    code,
    label: String(raw.label || '').trim(),
    sort_order: Number.isFinite(Number(raw.sort_order)) ? Number(raw.sort_order) : 0,
  };
}

async function fetchFormats(supabase) {
  const { data, error } = await supabase
    .from('formats')
    .select('code, label, sort_order, width_cm, height_cm, created_at, updated_at')
    .order('sort_order', { ascending: true })
    .order('code', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function fetchTechniques(supabase) {
  const { data, error } = await supabase
    .from('techniques')
    .select('code, label, sort_order, created_at, updated_at')
    .order('sort_order', { ascending: true })
    .order('code', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function fetchCodesWithCounts(supabase) {
  const [formats, techniques] = await Promise.all([
    fetchFormats(supabase),
    fetchTechniques(supabase),
  ]);
  const { data: works, error } = await supabase
    .from('works')
    .select('format_code, technique_code');
  if (error) throw error;

  const formatCounts = new Map();
  const techniqueCounts = new Map();
  for (const w of works || []) {
    if (w.format_code) formatCounts.set(w.format_code, (formatCounts.get(w.format_code) || 0) + 1);
    if (w.technique_code) {
      techniqueCounts.set(w.technique_code, (techniqueCounts.get(w.technique_code) || 0) + 1);
    }
  }

  return {
    formats: formats.map((f) => ({ ...f, work_count: formatCounts.get(f.code) || 0 })),
    techniques: techniques.map((t) => ({ ...t, work_count: techniqueCounts.get(t.code) || 0 })),
  };
}

async function nextSortOrder(supabase, table) {
  const { data } = await supabase
    .from(table)
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.sort_order ?? 0) + 1;
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
      sendJson(res, 200, { ok: true, service: 'codes-editor-api' });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/codes') {
      if (url.searchParams.get('token') !== TOKEN) {
        sendJson(res, 403, { ok: false, error: 'token incorrect' });
        return;
      }
      const supabase = createSupabase();
      const { formats, techniques } = await fetchCodesWithCounts(supabase);
      sendJson(res, 200, { ok: true, formats, techniques });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/formats/create') {
      const body = JSON.parse(await readBody(req));
      if (body.token !== TOKEN) {
        sendJson(res, 403, { ok: false, error: 'token incorrect' });
        return;
      }
      const code = String(body.code || '').trim().toUpperCase();
      if (!/^[A-Z0-9]{4}$/.test(code)) {
        sendJson(res, 400, { ok: false, error: 'code format invalide (4 caractères)' });
        return;
      }
      const supabase = createSupabase();
      const { data: existing } = await supabase
        .from('formats')
        .select('code')
        .eq('code', code)
        .maybeSingle();
      if (existing) {
        sendJson(res, 400, { ok: false, error: `code ${code} déjà utilisé` });
        return;
      }
      const { error } = await supabase.from('formats').insert({
        code,
        label: '',
        width_cm: null,
        height_cm: null,
        sort_order: await nextSortOrder(supabase, 'formats'),
      });
      if (error) throw error;
      const lists = await fetchCodesWithCounts(supabase);
      sendJson(res, 200, { ok: true, ...lists, createdCode: code });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/techniques/create') {
      const body = JSON.parse(await readBody(req));
      if (body.token !== TOKEN) {
        sendJson(res, 403, { ok: false, error: 'token incorrect' });
        return;
      }
      const code = String(body.code || '').trim().toUpperCase();
      if (!/^[A-Z0-9]{3}$/.test(code)) {
        sendJson(res, 400, { ok: false, error: 'code technique invalide (3 caractères)' });
        return;
      }
      const supabase = createSupabase();
      const { data: existing } = await supabase
        .from('techniques')
        .select('code')
        .eq('code', code)
        .maybeSingle();
      if (existing) {
        sendJson(res, 400, { ok: false, error: `code ${code} déjà utilisé` });
        return;
      }
      const { error } = await supabase.from('techniques').insert({
        code,
        label: '',
        sort_order: await nextSortOrder(supabase, 'techniques'),
      });
      if (error) throw error;
      const lists = await fetchCodesWithCounts(supabase);
      sendJson(res, 200, { ok: true, ...lists, createdCode: code });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/codes/save') {
      const body = JSON.parse(await readBody(req));
      if (body.token !== TOKEN) {
        sendJson(res, 403, { ok: false, error: 'token incorrect' });
        return;
      }
      const formatRows = Array.isArray(body.formats) ? body.formats : [];
      const techniqueRows = Array.isArray(body.techniques) ? body.techniques : [];
      if (!formatRows.length && !techniqueRows.length) {
        sendJson(res, 400, { ok: false, error: 'rien à enregistrer' });
        return;
      }
      const supabase = createSupabase();
      if (formatRows.length) {
        const payload = formatRows.map((r) => normalizeFormatInput(r));
        const { error } = await supabase.from('formats').upsert(payload, { onConflict: 'code' });
        if (error) throw error;
      }
      if (techniqueRows.length) {
        const payload = techniqueRows.map((r) => normalizeTechniqueInput(r));
        const { error } = await supabase.from('techniques').upsert(payload, { onConflict: 'code' });
        if (error) throw error;
      }
      const lists = await fetchCodesWithCounts(supabase);
      sendJson(res, 200, { ok: true, ...lists });
      return;
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/api/formats/')) {
      const code = decodeURIComponent(url.pathname.slice('/api/formats/'.length)).trim().toUpperCase();
      if (url.searchParams.get('token') !== TOKEN) {
        sendJson(res, 403, { ok: false, error: 'token incorrect' });
        return;
      }
      if (!code) {
        sendJson(res, 400, { ok: false, error: 'code manquant' });
        return;
      }
      const supabase = createSupabase();
      const { count, error: cErr } = await supabase
        .from('works')
        .select('id', { count: 'exact', head: true })
        .eq('format_code', code);
      if (cErr) throw cErr;
      if ((count || 0) > 0) {
        sendJson(res, 400, {
          ok: false,
          error: `impossible de supprimer ${code} : ${count} tableau(x) lié(s)`,
        });
        return;
      }
      const { error } = await supabase.from('formats').delete().eq('code', code);
      if (error) throw error;
      const lists = await fetchCodesWithCounts(supabase);
      sendJson(res, 200, { ok: true, ...lists });
      return;
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/api/techniques/')) {
      const code = decodeURIComponent(url.pathname.slice('/api/techniques/'.length)).trim().toUpperCase();
      if (url.searchParams.get('token') !== TOKEN) {
        sendJson(res, 403, { ok: false, error: 'token incorrect' });
        return;
      }
      if (!code) {
        sendJson(res, 400, { ok: false, error: 'code manquant' });
        return;
      }
      const supabase = createSupabase();
      const { count, error: cErr } = await supabase
        .from('works')
        .select('id', { count: 'exact', head: true })
        .eq('technique_code', code);
      if (cErr) throw cErr;
      if ((count || 0) > 0) {
        sendJson(res, 400, {
          ok: false,
          error: `impossible de supprimer ${code} : ${count} tableau(x) lié(s)`,
        });
        return;
      }
      const { error } = await supabase.from('techniques').delete().eq('code', code);
      if (error) throw error;
      const lists = await fetchCodesWithCounts(supabase);
      sendJson(res, 200, { ok: true, ...lists });
      return;
    }

    sendJson(res, 404, { ok: false, error: 'not found' });
  } catch (e) {
    console.error(e);
    sendJson(res, 500, { ok: false, error: String(e?.message || e) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.error(`codes-editor-api → http://127.0.0.1:${PORT}/`);
});
