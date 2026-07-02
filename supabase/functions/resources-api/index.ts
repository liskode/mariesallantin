import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

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
  const prefixes = ['/resources-api', '/functions/v1/resources-api'];
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

function parseDate(v: unknown): string | null {
  if (v === '' || v == null) return null;
  const s = String(v).trim();
  if (/^\d{4}$/.test(s)) return s + '-01-01';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

function parseDuration(v: unknown): number | null {
  if (v === '' || v == null) return null;
  const n = parseInt(String(v), 10);
  if (Number.isNaN(n) || n <= 0) return null;
  return n;
}

function normalizeResourceInput(raw: Record<string, unknown>) {
  const id = String(raw.id || '').trim();
  const media_type_code = String(raw.media_type_code || 'W').trim().toUpperCase();
  const title = String(raw.title || '').trim();
  const publication_status_code = String(raw.publication_status_code || 'N')
    .trim()
    .toUpperCase();

  return {
    id,
    media_type_code,
    title,
    media_date: parseDate(raw.media_date),
    source: String(raw.source || '').trim(),
    description: String(raw.description || '').trim(),
    url: String(raw.url || '').trim(),
    thumbnail_path: String(raw.thumbnail_path || '').trim(),
    file_path: String(raw.file_path || '').trim(),
    internal_path: String(raw.internal_path || '').trim(),
    duration_seconds: parseDuration(raw.duration_seconds),
    publication_status_code,
    sort_order: Number.isFinite(Number(raw.sort_order)) ? Number(raw.sort_order) : 0,
    is_essential: Boolean(raw.is_essential),
    series_codes: Array.isArray(raw.series_codes)
      ? [...new Set(raw.series_codes.map((c) => String(c).trim().toUpperCase()).filter(Boolean))]
      : [],
  };
}

async function fetchEditorPayload(supabase: SupabaseClient) {
  const [typesRes, statusesRes, seriesRes, mediaRes, seriesLinksRes] = await Promise.all([
    supabase.from('media_types').select('code, label, sort_order').order('sort_order', { ascending: true }),
    supabase.from('publication_statuses').select('code, label, sort_order').order('sort_order', { ascending: true }),
    supabase.from('series').select('code, label, sort_order').order('sort_order', { ascending: true }),
    supabase
      .from('related_media')
      .select(
        'id, media_type_code, title, media_date, source, description, url, thumbnail_path, file_path, internal_path, duration_seconds, publication_status_code, sort_order, is_essential, created_at, updated_at'
      )
      .order('sort_order', { ascending: true })
      .order('media_date', { ascending: false }),
    supabase.from('related_media_series').select('media_id, series_code'),
  ]);

  if (typesRes.error) throw typesRes.error;
  if (statusesRes.error) throw statusesRes.error;
  if (seriesRes.error) throw seriesRes.error;
  if (mediaRes.error) throw mediaRes.error;
  if (seriesLinksRes.error) throw seriesLinksRes.error;

  const seriesByMedia = new Map<string, string[]>();
  for (const row of seriesLinksRes.data || []) {
    const id = String(row.media_id);
    const list = seriesByMedia.get(id) || [];
    list.push(String(row.series_code));
    seriesByMedia.set(id, list);
  }

  const items = (mediaRes.data || []).map((row) => ({
    ...row,
    series_codes: [...new Set(seriesByMedia.get(String(row.id)) || [])].sort(),
  }));

  return {
    media_types: typesRes.data || [],
    publication_statuses: statusesRes.data || [],
    series: seriesRes.data || [],
    items,
  };
}

async function syncSeriesLinks(
  supabase: SupabaseClient,
  mediaId: string,
  seriesCodes: string[]
) {
  const { error: delErr } = await supabase.from('related_media_series').delete().eq('media_id', mediaId);
  if (delErr) throw delErr;
  if (!seriesCodes.length) return;
  const rows = seriesCodes.map((series_code) => ({ media_id: mediaId, series_code }));
  const { error: insErr } = await supabase.from('related_media_series').insert(rows);
  if (insErr) throw insErr;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = routePath(url.pathname);

  try {
    if (req.method === 'GET' && path === '/api/health') {
      return jsonResponse(200, { ok: true, service: 'resources-api' });
    }

    if (req.method === 'GET' && path === '/api/resources') {
      const token = url.searchParams.get('token') || '';
      if (!checkToken(token)) {
        return jsonResponse(403, { ok: false, error: 'token incorrect' });
      }
      const supabase = createSupabase();
      const payload = await fetchEditorPayload(supabase);
      return jsonResponse(200, { ok: true, ...payload });
    }

    if (req.method === 'POST' && path === '/api/resources/create') {
      const body = await req.json();
      if (!checkToken(String(body.token || ''))) {
        return jsonResponse(403, { ok: false, error: 'token incorrect' });
      }
      const supabase = createSupabase();
      const { data: last } = await supabase
        .from('related_media')
        .select('sort_order')
        .order('sort_order', { ascending: false })
        .limit(1)
        .maybeSingle();
      const sort_order = (last?.sort_order ?? 0) + 10;
      const { error } = await supabase.from('related_media').insert({
        media_type_code: 'W',
        title: 'Nouvelle ressource',
        source: '',
        description: '',
        url: '',
        thumbnail_path: '',
        file_path: '',
        internal_path: '',
        publication_status_code: 'N',
        sort_order,
      });
      if (error) throw error;
      const payload = await fetchEditorPayload(supabase);
      return jsonResponse(200, { ok: true, ...payload });
    }

    if (req.method === 'POST' && path === '/api/resources/save') {
      const body = await req.json();
      if (!checkToken(String(body.token || ''))) {
        return jsonResponse(403, { ok: false, error: 'token incorrect' });
      }
      const rows = Array.isArray(body.items) ? body.items : [];
      if (!rows.length) {
        return jsonResponse(400, { ok: false, error: 'aucune ressource à enregistrer' });
      }

      const supabase = createSupabase();
      const normalized = rows.map((r: Record<string, unknown>) => {
        const item = normalizeResourceInput(r);
        if (!item.id) throw new Error('id manquant');
        if (!item.title) throw new Error('titre manquant pour ' + item.id);
        return item;
      });

      for (const item of normalized) {
        const { series_codes, ...row } = item;
        const { error } = await supabase.from('related_media').upsert(row, { onConflict: 'id' });
        if (error) throw error;
        await syncSeriesLinks(supabase, row.id, series_codes);
      }

      const payload = await fetchEditorPayload(supabase);
      return jsonResponse(200, { ok: true, ...payload });
    }

    if (req.method === 'DELETE' && path.startsWith('/api/resources/')) {
      const id = decodeURIComponent(path.slice('/api/resources/'.length)).trim();
      const token = url.searchParams.get('token') || '';
      if (!checkToken(token)) {
        return jsonResponse(403, { ok: false, error: 'token incorrect' });
      }
      if (!id) {
        return jsonResponse(400, { ok: false, error: 'id manquant' });
      }
      const supabase = createSupabase();
      const { error } = await supabase.from('related_media').delete().eq('id', id);
      if (error) throw error;
      const payload = await fetchEditorPayload(supabase);
      return jsonResponse(200, { ok: true, ...payload });
    }

    return jsonResponse(404, { ok: false, error: 'not found' });
  } catch (e) {
    console.error(e);
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse(500, { ok: false, error: message });
  }
});
