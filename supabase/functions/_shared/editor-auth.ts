/** Authentification éditeur : sessions signées HMAC, rôles artist / admin. */

export const ROLES = { ARTIST: 'artist', ADMIN: 'admin' } as const;
export type EditorRole = (typeof ROLES)[keyof typeof ROLES];
export const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

function getSecret(): string {
  const secret = Deno.env.get('CATALOGUE_EDITOR_SECRET') || Deno.env.get('CATALOGUE_EDITOR_TOKEN');
  if (!secret) {
    throw new Error('CATALOGUE_EDITOR_SECRET requis (ou CATALOGUE_EDITOR_TOKEN legacy)');
  }
  return secret;
}

function legacyAdminToken(): string {
  return Deno.env.get('CATALOGUE_EDITOR_TOKEN') || 'MS75';
}

function passwordForRole(role: string): string | null {
  if (role === ROLES.ADMIN) {
    return Deno.env.get('CATALOGUE_EDITOR_PASSWORD_ADMIN') || legacyAdminToken();
  }
  if (role === ROLES.ARTIST) {
    return Deno.env.get('CATALOGUE_EDITOR_PASSWORD_ARTIST') || '';
  }
  return null;
}

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const sa = enc.encode(a);
  const sb = enc.encode(b);
  if (sa.length !== sb.length) return false;
  let diff = 0;
  for (let i = 0; i < sa.length; i++) diff |= sa[i] ^ sb[i];
  return diff === 0;
}

function toBase64Url(bytes: Uint8Array): string {
  const bin = String.fromCharCode(...bytes);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(str: string): Uint8Array {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

async function signPayload(payloadB64: string): Promise<string> {
  const key = await importHmacKey(getSecret());
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
  return toBase64Url(new Uint8Array(sig));
}

export async function createSessionToken(role: EditorRole): Promise<string> {
  const now = Date.now();
  const payload = { role, exp: now + TOKEN_TTL_MS, iat: now, v: 1 };
  const payloadB64 = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${payloadB64}.${await signPayload(payloadB64)}`;
}

export async function verifySessionToken(
  token: string
): Promise<{ role: EditorRole; exp?: number; legacy?: boolean } | null> {
  const raw = String(token || '').trim();
  if (!raw) return null;

  if (timingSafeEqual(raw, legacyAdminToken())) {
    return { role: ROLES.ADMIN, legacy: true };
  }

  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;
  const payloadB64 = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  if (!timingSafeEqual(await signPayload(payloadB64), sig)) return null;

  let payload: { role?: string; exp?: number };
  try {
    payload = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadB64)));
  } catch {
    return null;
  }

  if (!payload?.exp || payload.exp < Date.now()) return null;
  if (payload.role !== ROLES.ARTIST && payload.role !== ROLES.ADMIN) return null;
  return { role: payload.role as EditorRole, exp: payload.exp };
}

export function verifyLogin(role: string, password: string): boolean {
  const r = String(role || '').trim().toLowerCase();
  const expected = passwordForRole(r);
  if (!expected) return false;
  return timingSafeEqual(String(password || ''), expected);
}

export async function requireAuth(
  token: string,
  minRole: EditorRole = ROLES.ARTIST
): Promise<{ role: EditorRole; exp?: number } | null> {
  const session = await verifySessionToken(token);
  if (!session) return null;
  if (minRole === ROLES.ADMIN && session.role !== ROLES.ADMIN) return null;
  return session;
}

export function extractToken(req: Request, body?: Record<string, unknown>): string {
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get('token');
  if (fromQuery) return fromQuery.trim();
  const auth = req.headers.get('Authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  if (body?.token) return String(body.token).trim();
  return '';
}

export async function loginResponse(role: string, password: string) {
  const r = String(role || '').trim().toLowerCase();
  if (r !== ROLES.ARTIST && r !== ROLES.ADMIN) {
    return { ok: false as const, status: 400, error: 'Profil invalide.' };
  }
  if (!verifyLogin(r, password)) {
    return { ok: false as const, status: 403, error: 'Identifiants incorrects.' };
  }
  const token = await createSessionToken(r as EditorRole);
  const session = await verifySessionToken(token);
  return {
    ok: true as const,
    status: 200,
    token,
    role: r as EditorRole,
    expiresAt: session?.exp || Date.now() + TOKEN_TTL_MS,
    expiresIn: TOKEN_TTL_MS,
  };
}

export async function sessionResponse(token: string) {
  const session = await verifySessionToken(token);
  if (!session) {
    return { ok: false as const, status: 403, error: 'session invalide ou expirée' };
  }
  return {
    ok: true as const,
    status: 200,
    role: session.role,
    expiresAt: session.exp || null,
  };
}
