import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';
import { sortFormats } from '../_shared/format-sort.ts';
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
  const prefixes = ['/codes-api', '/functions/v1/codes-api'];
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

function parseCm(v: unknown): number | null {
  if (v === '' || v == null) return null;
  const n = parseFloat(String(v).replace(',', '.'));
  if (Number.isNaN(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function normalizeFormatInput(raw: Record<string, unknown>) {
  const code = String(raw.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(code)) {
    throw new Error(`code format invalide : ${code || '(vide)'}`);
  }
  return {
    code,
    label: String(raw.label || '').trim(),
    width_cm: parseCm(raw.width_cm),
    height_cm: parseCm(raw.height_cm),
    sort_order: Number.isFinite(Number(raw.sort_order)) ? Number(raw.sort_order) : 0,
  };
}

function normalizeTechniqueInput(raw: Record<string, unknown>) {
  const code = String(raw.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{3}$/.test(code)) {
    throw new Error(`code technique invalide : ${code || '(vide)'}`);
  }
  return {
    code,
    label: String(raw.label || '').trim(),
    sort_order: Number.isFinite(Number(raw.sort_order)) ? Number(raw.sort_order) : 0,
  };
}

async function fetchFormats(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from('formats')
    .select('code, label, sort_order, width_cm, height_cm, created_at, updated_at')
    .order('code', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function fetchTechniques(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from('techniques')
    .select('code, label, sort_order, created_at, updated_at')
    .order('code', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function fetchCodesWithCounts(supabase: SupabaseClient) {
  const [formats, techniques] = await Promise.all([
    fetchFormats(supabase),
    fetchTechniques(supabase),
  ]);
  const { data: works, error } = await supabase
    .from('works')
    .select('format_code, technique_code');
  if (error) throw error;

  const formatCounts = new Map<string, number>();
  const techniqueCounts = new Map<string, number>();
  for (const w of works || []) {
    const fc = w.format_code as string | null;
    const tc = w.technique_code as string | null;
    if (fc) formatCounts.set(fc, (formatCounts.get(fc) || 0) + 1);
    if (tc) techniqueCounts.set(tc, (techniqueCounts.get(tc) || 0) + 1);
  }

  return {
    formats: sortFormats(formats).map((f) => ({
      ...f,
      work_count: formatCounts.get(f.code as string) || 0,
    })),
    techniques: techniques.map((t) => ({
      ...t,
      work_count: techniqueCounts.get(t.code as string) || 0,
    })),
  };
}

async function nextSortOrder(
  supabase: SupabaseClient,
  table: 'formats' | 'techniques'
): Promise<number> {
  const { data } = await supabase
    .from(table)
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.sort_order ?? 0) + 1;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = routePath(url.pathname);

  try {
    if (req.method === 'GET' && path === '/api/health') {
      return jsonResponse(200, { ok: true, service: 'codes-api' });
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

    if (req.method === 'GET' && path === '/api/codes') {
      const auth = await requireAuth(extractToken(req), ROLES.ARTIST);
      if (!auth) {
        return jsonResponse(403, { ok: false, error: 'session invalide ou expirée' });
      }
      const supabase = createSupabase();
      const { formats, techniques } = await fetchCodesWithCounts(supabase);
      return jsonResponse(200, { ok: true, formats, techniques });
    }

    if (req.method === 'POST' && path === '/api/formats/create') {
      const body = await req.json();
      const auth = await requireAuth(extractToken(req, body), ROLES.ARTIST);
      if (!auth) {
        return jsonResponse(403, { ok: false, error: 'session invalide ou expirée' });
      }
      const code = String(body.code || '').trim().toUpperCase();
      if (!/^[A-Z0-9]{4}$/.test(code)) {
        return jsonResponse(400, { ok: false, error: 'code format invalide (4 caractères)' });
      }
      const supabase = createSupabase();
      const { data: existing } = await supabase
        .from('formats')
        .select('code')
        .eq('code', code)
        .maybeSingle();
      if (existing) {
        return jsonResponse(400, { ok: false, error: `code ${code} déjà utilisé` });
      }
      const row = {
        code,
        label: '',
        width_cm: null,
        height_cm: null,
        sort_order: await nextSortOrder(supabase, 'formats'),
      };
      const { error } = await supabase.from('formats').insert(row);
      if (error) throw error;
      await logEditorAction(supabase, {
        editor_role: auth.role,
        action_type: 'save',
        entity_type: 'format',
        entity_key: code,
        snapshot_before: null,
      });
      const { formats, techniques } = await fetchCodesWithCounts(supabase);
      return jsonResponse(200, { ok: true, formats, techniques, createdCode: code });
    }

    if (req.method === 'POST' && path === '/api/techniques/create') {
      const body = await req.json();
      const auth = await requireAuth(extractToken(req, body), ROLES.ARTIST);
      if (!auth) {
        return jsonResponse(403, { ok: false, error: 'session invalide ou expirée' });
      }
      const code = String(body.code || '').trim().toUpperCase();
      if (!/^[A-Z0-9]{3}$/.test(code)) {
        return jsonResponse(400, { ok: false, error: 'code technique invalide (3 caractères)' });
      }
      const supabase = createSupabase();
      const { data: existing } = await supabase
        .from('techniques')
        .select('code')
        .eq('code', code)
        .maybeSingle();
      if (existing) {
        return jsonResponse(400, { ok: false, error: `code ${code} déjà utilisé` });
      }
      const row = {
        code,
        label: '',
        sort_order: await nextSortOrder(supabase, 'techniques'),
      };
      const { error } = await supabase.from('techniques').insert(row);
      if (error) throw error;
      await logEditorAction(supabase, {
        editor_role: auth.role,
        action_type: 'save',
        entity_type: 'technique',
        entity_key: code,
        snapshot_before: null,
      });
      const { formats, techniques } = await fetchCodesWithCounts(supabase);
      return jsonResponse(200, { ok: true, formats, techniques, createdCode: code });
    }

    if (req.method === 'POST' && path === '/api/codes/save') {
      const body = await req.json();
      const auth = await requireAuth(extractToken(req, body), ROLES.ARTIST);
      if (!auth) {
        return jsonResponse(403, { ok: false, error: 'session invalide ou expirée' });
      }
      const formatRows = Array.isArray(body.formats) ? body.formats : [];
      const techniqueRows = Array.isArray(body.techniques) ? body.techniques : [];
      if (!formatRows.length && !techniqueRows.length) {
        return jsonResponse(400, { ok: false, error: 'rien à enregistrer' });
      }

      const supabase = createSupabase();
      for (const r of formatRows) {
        const row = normalizeFormatInput(r as Record<string, unknown>);
        const { data: before } = await supabase
          .from('formats')
          .select('*')
          .eq('code', row.code)
          .maybeSingle();
        const { error } = await supabase.from('formats').upsert(row, { onConflict: 'code' });
        if (error) throw error;
        await logEditorAction(supabase, {
          editor_role: auth.role,
          action_type: 'save',
          entity_type: 'format',
          entity_key: row.code,
          snapshot_before: (before as Record<string, unknown>) || null,
        });
      }
      for (const r of techniqueRows) {
        const row = normalizeTechniqueInput(r as Record<string, unknown>);
        const { data: before } = await supabase
          .from('techniques')
          .select('*')
          .eq('code', row.code)
          .maybeSingle();
        const { error } = await supabase.from('techniques').upsert(row, { onConflict: 'code' });
        if (error) throw error;
        await logEditorAction(supabase, {
          editor_role: auth.role,
          action_type: 'save',
          entity_type: 'technique',
          entity_key: row.code,
          snapshot_before: (before as Record<string, unknown>) || null,
        });
      }

      const { formats, techniques } = await fetchCodesWithCounts(supabase);
      return jsonResponse(200, { ok: true, formats, techniques });
    }

    if (req.method === 'DELETE' && path.startsWith('/api/formats/')) {
      const code = decodeURIComponent(path.slice('/api/formats/'.length)).trim().toUpperCase();
      const auth = await requireAuth(extractToken(req), ROLES.ADMIN);
      if (!auth) {
        return jsonResponse(403, { ok: false, error: 'accès réservé aux administrateurs' });
      }
      if (!code) {
        return jsonResponse(400, { ok: false, error: 'code manquant' });
      }
      const supabase = createSupabase();
      const { data: before } = await supabase.from('formats').select('*').eq('code', code).maybeSingle();
      const { count, error: cErr } = await supabase
        .from('works')
        .select('id', { count: 'exact', head: true })
        .eq('format_code', code);
      if (cErr) throw cErr;
      if ((count || 0) > 0) {
        return jsonResponse(400, {
          ok: false,
          error: `impossible de supprimer ${code} : ${count} tableau(x) lié(s)`,
        });
      }
      const { error } = await supabase.from('formats').delete().eq('code', code);
      if (error) throw error;
      await logEditorAction(supabase, {
        editor_role: auth.role,
        action_type: 'delete',
        entity_type: 'format',
        entity_key: code,
        snapshot_before: (before as Record<string, unknown>) || null,
      });
      const lists = await fetchCodesWithCounts(supabase);
      return jsonResponse(200, { ok: true, ...lists });
    }

    if (req.method === 'DELETE' && path.startsWith('/api/techniques/')) {
      const code = decodeURIComponent(path.slice('/api/techniques/'.length)).trim().toUpperCase();
      const auth = await requireAuth(extractToken(req), ROLES.ADMIN);
      if (!auth) {
        return jsonResponse(403, { ok: false, error: 'accès réservé aux administrateurs' });
      }
      if (!code) {
        return jsonResponse(400, { ok: false, error: 'code manquant' });
      }
      const supabase = createSupabase();
      const { data: before } = await supabase.from('techniques').select('*').eq('code', code).maybeSingle();
      const { count, error: cErr } = await supabase
        .from('works')
        .select('id', { count: 'exact', head: true })
        .eq('technique_code', code);
      if (cErr) throw cErr;
      if ((count || 0) > 0) {
        return jsonResponse(400, {
          ok: false,
          error: `impossible de supprimer ${code} : ${count} tableau(x) lié(s)`,
        });
      }
      const { error } = await supabase.from('techniques').delete().eq('code', code);
      if (error) throw error;
      await logEditorAction(supabase, {
        editor_role: auth.role,
        action_type: 'delete',
        entity_type: 'technique',
        entity_key: code,
        snapshot_before: (before as Record<string, unknown>) || null,
      });
      const lists = await fetchCodesWithCounts(supabase);
      return jsonResponse(200, { ok: true, ...lists });
    }

    return jsonResponse(404, { ok: false, error: 'not found' });
  } catch (e) {
    console.error(e);
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse(500, { ok: false, error: message });
  }
});
