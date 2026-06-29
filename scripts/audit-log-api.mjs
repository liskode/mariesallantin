#!/usr/bin/env node
/**
 * API locale — journal des modifications éditeur (lecture admin).
 * Usage : npm run audit:api  →  http://127.0.0.1:47836/
 */
import http from 'node:http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { fetchAuditLog } from './audit-log.mjs';
import {
  ROLES,
  authFromRequest,
  bootstrapEditorEnv,
  handleLoginRoute,
  handleSessionRoute,
} from './local-api-auth.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const PORT = Number(process.env.AUDIT_LOG_PORT || 47836);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

const STATIC_ROUTES = {
  '/': 'audit-log.html',
  '/audit-log.html': 'audit-log.html',
  '/audit-log.js': 'audit-log.js',
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

bootstrapEditorEnv(root, loadEnvFile);

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

    if (req.method === 'GET' && url.pathname === '/api/health') {
      sendJson(res, 200, { ok: true, service: 'audit-log-api' });
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

    if (req.method === 'GET' && url.pathname === '/api/audit-log') {
      if (!authFromRequest(req, url, null, ROLES.ADMIN)) {
        sendJson(res, 403, { ok: false, error: 'accès réservé aux administrateurs' });
        return;
      }
      const limit = Math.min(
        1000,
        Math.max(1, parseInt(url.searchParams.get('limit') || '500', 10) || 500)
      );
      const entries = await fetchAuditLog(createSupabase(), limit);
      sendJson(res, 200, { ok: true, entries });
      return;
    }

    sendJson(res, 404, { ok: false, error: 'not found' });
  } catch (e) {
    console.error(e);
    sendJson(res, 500, { ok: false, error: String(e?.message || e) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.error(`audit-log-api → http://127.0.0.1:${PORT}/`);
});
