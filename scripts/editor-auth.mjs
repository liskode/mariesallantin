/**
 * Authentification éditeur : sessions signées HMAC, rôles artist / admin.
 * Mots de passe uniquement côté serveur (.env / secrets Supabase).
 */
import crypto from 'node:crypto';

export const ROLES = Object.freeze({ ARTIST: 'artist', ADMIN: 'admin' });
export const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

export function getSecret() {
  const secret = process.env.CATALOGUE_EDITOR_SECRET || process.env.CATALOGUE_EDITOR_TOKEN;
  if (!secret) {
    throw new Error('CATALOGUE_EDITOR_SECRET requis (ou CATALOGUE_EDITOR_TOKEN legacy)');
  }
  return secret;
}

function legacyAdminToken() {
  return process.env.CATALOGUE_EDITOR_TOKEN || 'MS75';
}

function passwordForRole(role) {
  if (role === ROLES.ADMIN) {
    return process.env.CATALOGUE_EDITOR_PASSWORD_ADMIN || legacyAdminToken();
  }
  if (role === ROLES.ARTIST) {
    return process.env.CATALOGUE_EDITOR_PASSWORD_ARTIST || '';
  }
  return null;
}

function timingSafeEqual(a, b) {
  const sa = Buffer.from(String(a));
  const sb = Buffer.from(String(b));
  if (sa.length !== sb.length) return false;
  return crypto.timingSafeEqual(sa, sb);
}

function signPayload(payloadB64) {
  return crypto.createHmac('sha256', getSecret()).update(payloadB64).digest('base64url');
}

export function createSessionToken(role) {
  if (role !== ROLES.ARTIST && role !== ROLES.ADMIN) {
    throw new Error('rôle invalide');
  }
  const now = Date.now();
  const payload = { role, exp: now + TOKEN_TTL_MS, iat: now, v: 1 };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${payloadB64}.${signPayload(payloadB64)}`;
}

export function verifySessionToken(token) {
  const raw = String(token || '').trim();
  if (!raw) return null;

  if (timingSafeEqual(raw, legacyAdminToken())) {
    return { role: ROLES.ADMIN, legacy: true };
  }

  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;
  const payloadB64 = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  if (!timingSafeEqual(signPayload(payloadB64), sig)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (!payload || typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
  if (payload.role !== ROLES.ARTIST && payload.role !== ROLES.ADMIN) return null;
  return { role: payload.role, exp: payload.exp };
}

export function verifyLogin(role, password) {
  const r = String(role || '').trim().toLowerCase();
  const expected = passwordForRole(r);
  if (!expected) return false;
  return timingSafeEqual(String(password || ''), expected);
}

export function requireAuth(token, minRole = ROLES.ARTIST) {
  const session = verifySessionToken(token);
  if (!session) return null;
  if (minRole === ROLES.ADMIN && session.role !== ROLES.ADMIN) return null;
  return session;
}

export function extractToken({ url, body, headers }) {
  const fromQuery = url?.searchParams?.get?.('token');
  if (fromQuery) return String(fromQuery).trim();
  const auth = headers?.authorization || headers?.get?.('Authorization');
  if (auth && String(auth).startsWith('Bearer ')) {
    return String(auth).slice(7).trim();
  }
  if (body?.token) return String(body.token).trim();
  return '';
}

export function loginResponse(role, password) {
  const r = String(role || '').trim().toLowerCase();
  if (r !== ROLES.ARTIST && r !== ROLES.ADMIN) {
    return { ok: false, status: 400, error: 'Profil invalide.' };
  }
  if (!verifyLogin(r, password)) {
    return { ok: false, status: 403, error: 'Identifiants incorrects.' };
  }
  const token = createSessionToken(r);
  const session = verifySessionToken(token);
  return {
    ok: true,
    status: 200,
    token,
    role: r,
    expiresAt: session?.exp || Date.now() + TOKEN_TTL_MS,
    expiresIn: TOKEN_TTL_MS,
  };
}

export function sessionResponse(token) {
  const session = verifySessionToken(token);
  if (!session) {
    return { ok: false, status: 403, error: 'session invalide ou expirée' };
  }
  return {
    ok: true,
    status: 200,
    role: session.role,
    expiresAt: session.exp || null,
  };
}

export function tabAllowedForRole(tabId, role) {
  const tab = { works: 1, series: 1, codes: 1, collectors: 1, 'audit-log': 2 }[tabId];
  if (!tab) return false;
  if (tab === 2) return role === ROLES.ADMIN;
  return role === ROLES.ARTIST || role === ROLES.ADMIN;
}
