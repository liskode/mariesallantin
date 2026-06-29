import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';
import {
  ROLES,
  extractToken,
  loginResponse,
  requireAuth,
  sessionResponse,
} from '../_shared/editor-auth.ts';
import { fetchAuditLog } from '../_shared/audit-log.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function routePath(pathname: string): string {
  const prefixes = ['/audit-log-api', '/functions/v1/audit-log-api'];
  for (const prefix of prefixes) {
    if (pathname === prefix) return '/';
    if (pathname.startsWith(prefix + '/')) return pathname.slice(prefix.length);
  }
  return pathname;
}

function createSupabase(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !key) {
    throw new Error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = routePath(url.pathname);

  try {
    if (req.method === 'GET' && path === '/api/health') {
      return jsonResponse(200, { ok: true, service: 'audit-log-api' });
    }

    if (req.method === 'POST' && path === '/api/login') {
      const body = await req.json();
      const result = await loginResponse(String(body.role || ''), String(body.password || ''));
      if (!result.ok) {
        return jsonResponse(result.status, { ok: false, error: result.error });
      }
      return jsonResponse(200, {
        ok: true,
        token: result.token,
        role: result.role,
        expiresAt: result.expiresAt,
        expiresIn: result.expiresIn,
      });
    }

    if (req.method === 'GET' && path === '/api/session') {
      const result = await sessionResponse(extractToken(req));
      if (!result.ok) {
        return jsonResponse(result.status, { ok: false, error: result.error });
      }
      return jsonResponse(200, {
        ok: true,
        role: result.role,
        expiresAt: result.expiresAt,
      });
    }

    if (req.method === 'GET' && path === '/api/audit-log') {
      const auth = await requireAuth(extractToken(req), ROLES.ADMIN);
      if (!auth) {
        return jsonResponse(403, { ok: false, error: 'accès réservé aux administrateurs' });
      }
      const limit = Math.min(
        1000,
        Math.max(1, parseInt(url.searchParams.get('limit') || '500', 10) || 500)
      );
      const supabase = createSupabase();
      const entries = await fetchAuditLog(supabase, limit);
      return jsonResponse(200, { ok: true, entries });
    }

    return jsonResponse(404, { ok: false, error: 'not found' });
  } catch (e) {
    console.error(e);
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse(500, { ok: false, error: message });
  }
});
