import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';
import {
  ROLES,
  extractToken,
  loginResponse,
  requireAuth,
  sessionResponse,
} from '../_shared/editor-auth.ts';
import { logEditorAction } from '../_shared/audit-log.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function routePath(pathname: string): string {
  const prefixes = ['/series-api', '/functions/v1/series-api'];
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

function normalizeSeriesInput(raw: Record<string, unknown>) {
  const code = String(raw.code || '').trim().toUpperCase();
  const label = String(raw.label || '').trim();
  let icon = String(raw.icon_work_id || '').trim().toUpperCase();
  if (icon && !/^MS\d{4}$/.test(icon)) icon = '';

  const parseYear = (v: unknown): number | null => {
    if (v === '' || v == null) return null;
    const n = parseInt(String(v), 10);
    if (Number.isNaN(n) || n < 1000 || n > 9999) return null;
    return n;
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

async function fetchSeriesWithCounts(supabase: SupabaseClient) {
  const { data: series, error } = await supabase
    .from('series')
    .select(
      'code, label, sort_order, icon_work_id, year_start, year_end, description, created_at, updated_at'
    )
    .order('sort_order', { ascending: true })
    .order('code', { ascending: true });

  if (error) throw error;

  const { data: links, error: lErr } = await supabase
    .from('work_series')
    .select('series_code');

  if (lErr) throw lErr;

  const counts = new Map<string, number>();
  for (const row of links || []) {
    const c = row.series_code as string;
    counts.set(c, (counts.get(c) || 0) + 1);
  }

  return (series || []).map((s) => ({
    ...s,
    work_count: counts.get(s.code as string) || 0,
  }));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = routePath(url.pathname);

  try {
    if (req.method === 'GET' && path === '/api/health') {
      return jsonResponse(200, { ok: true, service: 'series-api' });
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

    if (req.method === 'GET' && path === '/api/series') {
      const auth = await requireAuth(extractToken(req), ROLES.ARTIST);
      if (!auth) {
        return jsonResponse(403, { ok: false, error: 'session invalide ou expirée' });
      }
      const supabase = createSupabase();
      const series = await fetchSeriesWithCounts(supabase);
      return jsonResponse(200, { ok: true, series });
    }

    if (req.method === 'POST' && path === '/api/series/create') {
      const body = await req.json();
      const auth = await requireAuth(extractToken(req, body), ROLES.ARTIST);
      if (!auth) {
        return jsonResponse(403, { ok: false, error: 'session invalide ou expirée' });
      }
      const code = String(body.code || '').trim().toUpperCase();
      if (!/^[A-Z0-9]{2,12}$/.test(code)) {
        return jsonResponse(400, {
          ok: false,
          error: 'code invalide (2–12 caractères A-Z, 0-9)',
        });
      }
      const label = String(body.label || '').trim();
      const supabase = createSupabase();
      const { data: existing } = await supabase
        .from('series')
        .select('code')
        .eq('code', code)
        .maybeSingle();
      if (existing) {
        return jsonResponse(400, { ok: false, error: `code ${code} déjà utilisé` });
      }
      const { data: last } = await supabase
        .from('series')
        .select('sort_order')
        .order('sort_order', { ascending: false })
        .limit(1)
        .maybeSingle();
      const sort_order = (last?.sort_order ?? 0) + 1;
      const row = {
        code,
        label,
        sort_order,
        icon_work_id: null,
        year_start: null,
        year_end: null,
        description: '',
      };
      const { error } = await supabase.from('series').insert(row);
      if (error) throw error;
      await logEditorAction(supabase, {
        editor_role: auth.role,
        action_type: 'save',
        entity_type: 'series',
        entity_key: code,
        snapshot_before: null,
      });
      const series = await fetchSeriesWithCounts(supabase);
      return jsonResponse(200, { ok: true, series });
    }

    if (req.method === 'POST' && path === '/api/series/save') {
      const body = await req.json();
      const auth = await requireAuth(extractToken(req, body), ROLES.ARTIST);
      if (!auth) {
        return jsonResponse(403, { ok: false, error: 'session invalide ou expirée' });
      }
      const rows = Array.isArray(body.series) ? body.series : [];
      if (!rows.length) {
        return jsonResponse(400, { ok: false, error: 'aucune série à enregistrer' });
      }

      const supabase = createSupabase();
      for (const r of rows) {
        const s = normalizeSeriesInput(r as Record<string, unknown>);
        if (!s.code) throw new Error('code manquant');
        const { data: before } = await supabase
          .from('series')
          .select('*')
          .eq('code', s.code)
          .maybeSingle();
        const { error } = await supabase.from('series').upsert(s, { onConflict: 'code' });
        if (error) throw error;
        await logEditorAction(supabase, {
          editor_role: auth.role,
          action_type: 'save',
          entity_type: 'series',
          entity_key: s.code,
          snapshot_before: (before as Record<string, unknown>) || null,
        });
      }

      const series = await fetchSeriesWithCounts(supabase);
      return jsonResponse(200, { ok: true, series });
    }

    if (req.method === 'DELETE' && path.startsWith('/api/series/')) {
      const code = decodeURIComponent(path.slice('/api/series/'.length)).trim().toUpperCase();
      const auth = await requireAuth(extractToken(req), ROLES.ADMIN);
      if (!auth) {
        return jsonResponse(403, { ok: false, error: 'accès réservé aux administrateurs' });
      }
      if (!code) {
        return jsonResponse(400, { ok: false, error: 'code manquant' });
      }
      const supabase = createSupabase();
      const { data: before } = await supabase.from('series').select('*').eq('code', code).maybeSingle();
      const { count: workCount, error: wErr } = await supabase
        .from('work_series')
        .select('work_id', { count: 'exact', head: true })
        .eq('series_code', code);
      if (wErr) throw wErr;
      const { count: mediaCount, error: mErr } = await supabase
        .from('related_media_series')
        .select('media_id', { count: 'exact', head: true })
        .eq('series_code', code);
      if (mErr) throw mErr;
      const total = (workCount || 0) + (mediaCount || 0);
      if (total > 0) {
        return jsonResponse(400, {
          ok: false,
          error: `impossible de supprimer ${code} : ${total} lien(s) actif(s)`,
        });
      }
      const { error } = await supabase.from('series').delete().eq('code', code);
      if (error) throw error;
      await logEditorAction(supabase, {
        editor_role: auth.role,
        action_type: 'delete',
        entity_type: 'series',
        entity_key: code,
        snapshot_before: (before as Record<string, unknown>) || null,
      });
      const series = await fetchSeriesWithCounts(supabase);
      return jsonResponse(200, { ok: true, series });
    }

    return jsonResponse(404, { ok: false, error: 'not found' });
  } catch (e) {
    console.error(e);
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse(500, { ok: false, error: message });
  }
});
