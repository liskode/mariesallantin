import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';
import {
  ROLES,
  extractToken,
  loginResponse,
  requireAuth,
  sessionResponse,
} from '../_shared/editor-auth.ts';
import { logEditorAction } from '../_shared/audit-log.ts';

const COLLECTOR_TYPES = new Set(['Galerie', 'Institutions', 'Particulier']);
const CODE_RE = /^COL(\d+)$/i;

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
  const prefixes = ['/collectors-api', '/functions/v1/collectors-api'];
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
    throw new Error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis (secrets Edge Function)');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function normalizeCollectorInput(raw: Record<string, unknown>) {
  const code = String(raw.code || '').trim();
  const name = String(raw.name || '').trim();
  const collector_type = COLLECTOR_TYPES.has(String(raw.collector_type))
    ? String(raw.collector_type)
    : 'Particulier';
  return {
    code,
    name,
    collector_type,
    first_name: String(raw.first_name || '').trim(),
    phone: String(raw.phone || '').trim(),
    email: String(raw.email || '').trim(),
    notes: String(raw.notes || '').trim(),
  };
}

async function nextCollectorCode(supabase: SupabaseClient): Promise<string> {
  const { data, error } = await supabase
    .from('collectors')
    .select('code')
    .order('code', { ascending: false })
    .limit(50);
  if (error) throw error;
  let max = 0;
  for (const row of data || []) {
    const m = CODE_RE.exec(String(row.code || ''));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return 'COL' + String(max + 1).padStart(4, '0');
}

async function fetchCollectorsWithCounts(supabase: SupabaseClient) {
  const { data: collectors, error } = await supabase
    .from('collectors')
    .select('code, name, collector_type, first_name, phone, email, notes, created_at, updated_at')
    .order('name', { ascending: true });
  if (error) throw error;

  const { data: works, error: wErr } = await supabase
    .from('works')
    .select('id, title, collector_code')
    .not('collector_code', 'is', null)
    .order('id', { ascending: true });
  if (wErr) throw wErr;

  const worksByCollector = new Map<string, { id: string; title: string }[]>();
  for (const row of works || []) {
    const code = row.collector_code as string;
    if (!worksByCollector.has(code)) worksByCollector.set(code, []);
    worksByCollector.get(code)!.push({
      id: row.id as string,
      title: String(row.title || '').trim(),
    });
  }

  return (collectors || []).map((c) => {
    const list = worksByCollector.get(c.code as string) || [];
    return {
      ...c,
      work_count: list.length,
      works: list,
    };
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = routePath(url.pathname);

  try {
    if (req.method === 'GET' && path === '/api/health') {
      return jsonResponse(200, { ok: true, service: 'collectors-api' });
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

    if (req.method === 'GET' && path === '/api/collectors') {
      const auth = await requireAuth(extractToken(req), ROLES.ARTIST);
      if (!auth) {
        return jsonResponse(403, { ok: false, error: 'session invalide ou expirée' });
      }
      const supabase = createSupabase();
      const collectors = await fetchCollectorsWithCounts(supabase);
      return jsonResponse(200, { ok: true, collectors });
    }

    if (req.method === 'POST' && path === '/api/collectors/save') {
      const body = await req.json();
      const auth = await requireAuth(extractToken(req, body), ROLES.ARTIST);
      if (!auth) {
        return jsonResponse(403, { ok: false, error: 'session invalide ou expirée' });
      }
      const rows = Array.isArray(body.collectors) ? body.collectors : [];
      if (!rows.length) {
        return jsonResponse(400, { ok: false, error: 'aucun collectionneur à enregistrer' });
      }
      const supabase = createSupabase();
      for (const r of rows) {
        const c = normalizeCollectorInput(r as Record<string, unknown>);
        if (!c.code) throw new Error('code manquant');
        if (!c.name) throw new Error(`nom manquant pour ${c.code}`);
        const { data: before } = await supabase
          .from('collectors')
          .select('*')
          .eq('code', c.code)
          .maybeSingle();
        const { error } = await supabase.from('collectors').upsert(c, { onConflict: 'code' });
        if (error) throw error;
        await logEditorAction(supabase, {
          editor_role: auth.role,
          action_type: 'save',
          entity_type: 'collector',
          entity_key: c.code,
          snapshot_before: (before as Record<string, unknown>) || null,
        });
      }
      const collectors = await fetchCollectorsWithCounts(supabase);
      return jsonResponse(200, { ok: true, collectors });
    }

    if (req.method === 'POST' && path === '/api/collectors/create') {
      const body = await req.json();
      const auth = await requireAuth(extractToken(req, body), ROLES.ARTIST);
      if (!auth) {
        return jsonResponse(403, { ok: false, error: 'session invalide ou expirée' });
      }
      const c = normalizeCollectorInput((body.collector || {}) as Record<string, unknown>);
      if (!c.name) {
        return jsonResponse(400, { ok: false, error: 'nom requis' });
      }
      const supabase = createSupabase();
      const code = await nextCollectorCode(supabase);
      const row = { ...c, code };
      const { error } = await supabase.from('collectors').insert(row);
      if (error) {
        return jsonResponse(400, { ok: false, error: error.message });
      }
      await logEditorAction(supabase, {
        editor_role: auth.role,
        action_type: 'save',
        entity_type: 'collector',
        entity_key: code,
        snapshot_before: null,
      });
      const collectors = await fetchCollectorsWithCounts(supabase);
      return jsonResponse(200, { ok: true, collector: row, collectors });
    }

    if (req.method === 'DELETE' && path.startsWith('/api/collectors/')) {
      const code = decodeURIComponent(path.slice('/api/collectors/'.length));
      const auth = await requireAuth(extractToken(req), ROLES.ADMIN);
      if (!auth) {
        return jsonResponse(403, { ok: false, error: 'accès réservé aux administrateurs' });
      }
      if (!code) {
        return jsonResponse(400, { ok: false, error: 'code manquant' });
      }
      const supabase = createSupabase();
      const { data: before } = await supabase.from('collectors').select('*').eq('code', code).maybeSingle();
      const { count, error: cErr } = await supabase
        .from('works')
        .select('id', { count: 'exact', head: true })
        .eq('collector_code', code);
      if (cErr) throw cErr;
      if ((count || 0) > 0) {
        return jsonResponse(400, {
          ok: false,
          error: `impossible de supprimer ${code} : ${count} œuvre(s) liée(s)`,
        });
      }
      const { error } = await supabase.from('collectors').delete().eq('code', code);
      if (error) throw error;
      await logEditorAction(supabase, {
        editor_role: auth.role,
        action_type: 'delete',
        entity_type: 'collector',
        entity_key: code,
        snapshot_before: (before as Record<string, unknown>) || null,
      });
      return jsonResponse(200, { ok: true });
    }

    return jsonResponse(404, { ok: false, error: 'not found' });
  } catch (e) {
    console.error(e);
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse(500, { ok: false, error: message });
  }
});
