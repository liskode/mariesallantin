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
  const prefixes = ['/works-api', '/functions/v1/works-api'];
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

function parseYear(v: unknown): number | null {
  if (v === '' || v == null) return null;
  const n = parseInt(String(v), 10);
  if (Number.isNaN(n) || n < 1000 || n > 9999) return null;
  return n;
}

function parseCm(v: unknown): number | null {
  if (v === '' || v == null) return null;
  const n = parseFloat(String(v).replace(',', '.'));
  if (Number.isNaN(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function normalizeWorkInput(raw: Record<string, unknown>) {
  const id = String(raw.id || '').trim().toUpperCase();
  if (!/^MS\d{4}$/.test(id)) {
    throw new Error(`id invalide : ${id || '(vide)'}`);
  }
  const seriesRaw = Array.isArray(raw.series_codes) ? raw.series_codes : [];
  const series_codes = [
    ...new Set(
      seriesRaw.map((c) => String(c || '').trim().toUpperCase()).filter(Boolean)
    ),
  ];
  return {
    row: {
      id,
      title: String(raw.title || '').trim(),
      year: parseYear(raw.year),
      format_code: String(raw.format_code || '').trim().toUpperCase() || null,
      technique_code: String(raw.technique_code || '').trim().toUpperCase() || null,
      publication_status_code: String(raw.publication_status_code || 'N').trim().toUpperCase(),
      photo_status_code: String(raw.photo_status_code || 'OK').trim().toUpperCase(),
      collector_code: String(raw.collector_code || '').trim().toUpperCase() || null,
      width_cm: parseCm(raw.width_cm),
      height_cm: parseCm(raw.height_cm),
      sort_order: Number.isFinite(Number(raw.sort_order)) ? Number(raw.sort_order) : 0,
    },
    series_codes,
  };
}

async function fetchMeta(supabase: SupabaseClient) {
  const [formats, techniques, series, collectors, publication_statuses, photo_statuses] =
    await Promise.all([
      supabase
        .from('formats')
        .select('code, label, width_cm, height_cm')
        .order('sort_order')
        .order('code'),
      supabase.from('techniques').select('code, label').order('sort_order').order('code'),
      supabase.from('series').select('code, label').order('sort_order').order('code'),
      supabase.from('collectors').select('code, name').order('name'),
      supabase
        .from('publication_statuses')
        .select('code, label')
        .order('sort_order')
        .order('code'),
      supabase.from('photo_statuses').select('code, label').order('sort_order').order('code'),
    ]);
  for (const r of [formats, techniques, series, collectors, publication_statuses, photo_statuses]) {
    if (r.error) throw r.error;
  }
  return {
    formats: formats.data || [],
    techniques: techniques.data || [],
    series: series.data || [],
    collectors: (collectors.data || []).map((c) => ({
      code: c.code,
      label: c.name || c.code,
    })),
    publication_statuses: publication_statuses.data || [],
    photo_statuses: photo_statuses.data || [],
  };
}

async function fetchWorksWithSeries(supabase: SupabaseClient) {
  const { data: works, error } = await supabase
    .from('works')
    .select(
      'id, title, year, format_code, technique_code, publication_status_code, photo_status_code, collector_code, width_cm, height_cm, filename_original, image_ext, sort_order, updated_at'
    )
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw error;

  const { data: links, error: lErr } = await supabase
    .from('work_series')
    .select('work_id, series_code');
  if (lErr) throw lErr;

  const byWork = new Map<string, string[]>();
  for (const row of links || []) {
    const wid = row.work_id as string;
    const code = row.series_code as string;
    if (!byWork.has(wid)) byWork.set(wid, []);
    byWork.get(wid)!.push(code);
  }

  return (works || []).map((w) => ({
    ...w,
    series_codes: byWork.get(w.id as string) || [],
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
      return jsonResponse(200, { ok: true, service: 'works-api' });
    }

    if (req.method === 'GET' && path === '/api/works/meta') {
      const token = url.searchParams.get('token') || '';
      if (!checkToken(token)) {
        return jsonResponse(403, { ok: false, error: 'token incorrect' });
      }
      const supabase = createSupabase();
      const meta = await fetchMeta(supabase);
      return jsonResponse(200, { ok: true, meta });
    }

    if (req.method === 'GET' && path === '/api/works') {
      const token = url.searchParams.get('token') || '';
      if (!checkToken(token)) {
        return jsonResponse(403, { ok: false, error: 'token incorrect' });
      }
      const supabase = createSupabase();
      const works = await fetchWorksWithSeries(supabase);
      return jsonResponse(200, { ok: true, works });
    }

    if (req.method === 'POST' && path === '/api/works/save') {
      const body = await req.json();
      if (!checkToken(String(body.token || ''))) {
        return jsonResponse(403, { ok: false, error: 'token incorrect' });
      }
      const rows = Array.isArray(body.works) ? body.works : [];
      if (!rows.length) {
        return jsonResponse(400, { ok: false, error: 'aucune œuvre à enregistrer' });
      }

      const supabase = createSupabase();
      const ids: string[] = [];

      for (const raw of rows) {
        const { row, series_codes } = normalizeWorkInput(raw as Record<string, unknown>);
        ids.push(row.id);
        const { error } = await supabase.from('works').upsert(row, { onConflict: 'id' });
        if (error) throw error;

        const { error: delErr } = await supabase.from('work_series').delete().eq('work_id', row.id);
        if (delErr) throw delErr;

        if (series_codes.length) {
          const payload = series_codes.map((code) => ({
            work_id: row.id,
            series_code: code,
          }));
          const { error: insErr } = await supabase.from('work_series').insert(payload);
          if (insErr) throw insErr;
        }
      }

      const works = await fetchWorksWithSeries(supabase);
      return jsonResponse(200, { ok: true, works, saved: ids.length });
    }

    return jsonResponse(404, { ok: false, error: 'not found' });
  } catch (e) {
    console.error(e);
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse(500, { ok: false, error: message });
  }
});
