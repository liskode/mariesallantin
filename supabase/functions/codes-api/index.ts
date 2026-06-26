import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

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
  const prefixes = ['/codes-api', '/functions/v1/codes-api'];
  for (const prefix of prefixes) {
    if (pathname === prefix) return '/';
    if (pathname.startsWith(prefix + '/')) return pathname.slice(prefix.length);
  }
  return pathname;
}

function checkToken(token: string): boolean {
  const expected = Deno.env.get('CATALOGUE_EDITOR_TOKEN') || 'MS75';
  return token === expected;
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
    .order('sort_order', { ascending: true })
    .order('code', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function fetchTechniques(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from('techniques')
    .select('code, label, sort_order, created_at, updated_at')
    .order('sort_order', { ascending: true })
    .order('code', { ascending: true });
  if (error) throw error;
  return data || [];
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

    if (req.method === 'GET' && path === '/api/codes') {
      const token = url.searchParams.get('token') || '';
      if (!checkToken(token)) {
        return jsonResponse(403, { ok: false, error: 'token incorrect' });
      }
      const supabase = createSupabase();
      const [formats, techniques] = await Promise.all([
        fetchFormats(supabase),
        fetchTechniques(supabase),
      ]);
      return jsonResponse(200, { ok: true, formats, techniques });
    }

    if (req.method === 'POST' && path === '/api/formats/create') {
      const body = await req.json();
      if (!checkToken(String(body.token || ''))) {
        return jsonResponse(403, { ok: false, error: 'token incorrect' });
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
      const formats = await fetchFormats(supabase);
      const techniques = await fetchTechniques(supabase);
      return jsonResponse(200, { ok: true, formats, techniques, createdCode: code });
    }

    if (req.method === 'POST' && path === '/api/techniques/create') {
      const body = await req.json();
      if (!checkToken(String(body.token || ''))) {
        return jsonResponse(403, { ok: false, error: 'token incorrect' });
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
      const formats = await fetchFormats(supabase);
      const techniques = await fetchTechniques(supabase);
      return jsonResponse(200, { ok: true, formats, techniques, createdCode: code });
    }

    if (req.method === 'POST' && path === '/api/codes/save') {
      const body = await req.json();
      if (!checkToken(String(body.token || ''))) {
        return jsonResponse(403, { ok: false, error: 'token incorrect' });
      }
      const formatRows = Array.isArray(body.formats) ? body.formats : [];
      const techniqueRows = Array.isArray(body.techniques) ? body.techniques : [];
      if (!formatRows.length && !techniqueRows.length) {
        return jsonResponse(400, { ok: false, error: 'rien à enregistrer' });
      }

      const supabase = createSupabase();
      if (formatRows.length) {
        const payload = formatRows.map((r: Record<string, unknown>) => normalizeFormatInput(r));
        const { error } = await supabase.from('formats').upsert(payload, { onConflict: 'code' });
        if (error) throw error;
      }
      if (techniqueRows.length) {
        const payload = techniqueRows.map((r: Record<string, unknown>) =>
          normalizeTechniqueInput(r)
        );
        const { error } = await supabase.from('techniques').upsert(payload, { onConflict: 'code' });
        if (error) throw error;
      }

      const [formats, techniques] = await Promise.all([
        fetchFormats(supabase),
        fetchTechniques(supabase),
      ]);
      return jsonResponse(200, { ok: true, formats, techniques });
    }

    return jsonResponse(404, { ok: false, error: 'not found' });
  } catch (e) {
    console.error(e);
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse(500, { ok: false, error: message });
  }
});
