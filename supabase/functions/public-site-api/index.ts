import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

const PUBLIC_STATUSES = ['W', 'G'];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function routePath(pathname: string): string {
  const prefixes = ['/public-site-api', '/functions/v1/public-site-api'];
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

async function fetchCatalog(supabase: SupabaseClient) {
  const [worksRes, seriesRes, linksRes, formatsRes, techniquesRes] = await Promise.all([
    supabase
      .from('works')
      .select(
        'id, title, year, image_ext, filename_original, publication_status_code, sort_order, format_code, technique_code'
      )
      .in('publication_status_code', PUBLIC_STATUSES)
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true }),
    supabase
      .from('series')
      .select('code, label, sort_order, icon_work_id, year_start, year_end, description')
      .order('sort_order', { ascending: true })
      .order('code', { ascending: true }),
    supabase.from('work_series').select('work_id, series_code'),
    supabase.from('formats').select('code, label, width_cm, height_cm').order('sort_order', { ascending: true }),
    supabase.from('techniques').select('code, label').order('sort_order', { ascending: true }),
  ]);

  if (worksRes.error) throw worksRes.error;
  if (seriesRes.error) throw seriesRes.error;
  if (linksRes.error) throw linksRes.error;
  if (formatsRes.error) throw formatsRes.error;
  if (techniquesRes.error) throw techniquesRes.error;

  const publicWorkIds = new Set((worksRes.data || []).map((w) => w.id));
  const seriesCodesWithWorks = new Set<string>();

  const linksByWork = new Map<string, string[]>();
  for (const link of linksRes.data || []) {
    if (!publicWorkIds.has(link.work_id)) continue;
    const list = linksByWork.get(link.work_id) || [];
    list.push(link.series_code);
    linksByWork.set(link.work_id, list);
    seriesCodesWithWorks.add(link.series_code);
  }

  const works = (worksRes.data || []).map((w) => ({
    id: w.id,
    title: w.title || '',
    year: w.year,
    image_ext: w.image_ext || 'jpeg',
    filename_original: w.filename_original || '',
    publication_status_code: w.publication_status_code,
    sort_order: w.sort_order ?? 0,
    format_code: w.format_code,
    technique_code: w.technique_code,
    series_codes: [...new Set(linksByWork.get(w.id) || [])].sort(),
  }));

  const visibleSeries = (seriesRes.data || []).filter((s) => seriesCodesWithWorks.has(s.code));
  const missingIconIds = [
    ...new Set(
      visibleSeries
        .map((s) => s.icon_work_id)
        .filter((id): id is string => Boolean(id) && !publicWorkIds.has(id))
    ),
  ];

  let iconWorks: Array<{
    id: string;
    title: string;
    image_ext: string;
    filename_original: string;
  }> = [];

  if (missingIconIds.length) {
    const iconRes = await supabase
      .from('works')
      .select('id, title, image_ext, filename_original')
      .in('id', missingIconIds);
    if (iconRes.error) throw iconRes.error;
    iconWorks = (iconRes.data || []).map((w) => ({
      id: w.id,
      title: w.title || '',
      image_ext: w.image_ext || 'jpeg',
      filename_original: w.filename_original || '',
    }));
  }

  const series = visibleSeries.map((s) => ({
    code: s.code,
    label: s.label || s.code,
    sort_order: s.sort_order ?? 0,
    icon_work_id: s.icon_work_id || null,
    year_start: s.year_start ?? null,
    year_end: s.year_end ?? null,
    description: String(s.description || '').trim(),
  }));

  return {
    ok: true,
    series,
    works,
    icon_works: iconWorks,
    formats: formatsRes.data || [],
    techniques: techniquesRes.data || [],
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const path = routePath(new URL(req.url).pathname);

  if (req.method !== 'GET') {
    return jsonResponse(405, { ok: false, error: 'Méthode non autorisée' });
  }

  if (path !== '/' && path !== '/api/catalog') {
    return jsonResponse(404, { ok: false, error: 'Route inconnue' });
  }

  try {
    const supabase = createSupabase();
    const catalog = await fetchCatalog(supabase);
    return jsonResponse(200, catalog);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('public-site-api:', message);
    return jsonResponse(500, { ok: false, error: message });
  }
});
