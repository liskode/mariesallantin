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

async function fetchResources(supabase: SupabaseClient) {
  const [typesRes, mediaRes, seriesRes, worksRes] = await Promise.all([
    supabase.from('media_types').select('code, label, sort_order').order('sort_order', { ascending: true }),
    supabase
      .from('related_media')
      .select(
        'id, media_type_code, title, media_date, source, description, url, thumbnail_path, file_path, internal_path, duration_seconds, publication_status_code, sort_order, is_essential'
      )
      .in('publication_status_code', PUBLIC_STATUSES)
      .order('sort_order', { ascending: true })
      .order('media_date', { ascending: false }),
    supabase.from('related_media_series').select('media_id, series_code'),
    supabase.from('related_media_works').select('media_id, work_id'),
  ]);

  if (typesRes.error) throw typesRes.error;
  if (mediaRes.error) throw mediaRes.error;
  if (seriesRes.error) throw seriesRes.error;
  if (worksRes.error) throw worksRes.error;

  const seriesByMedia = new Map<string, string[]>();
  for (const row of seriesRes.data || []) {
    const id = String(row.media_id);
    const list = seriesByMedia.get(id) || [];
    list.push(String(row.series_code));
    seriesByMedia.set(id, list);
  }

  const worksByMedia = new Map<string, string[]>();
  for (const row of worksRes.data || []) {
    const id = String(row.media_id);
    const list = worksByMedia.get(id) || [];
    list.push(String(row.work_id));
    worksByMedia.set(id, list);
  }

  const items = (mediaRes.data || []).map((row) => ({
    id: row.id,
    media_type_code: row.media_type_code,
    title: row.title || '',
    media_date: row.media_date,
    source: row.source || '',
    description: row.description || '',
    url: row.url || '',
    thumbnail_path: row.thumbnail_path || '',
    file_path: row.file_path || '',
    internal_path: row.internal_path || '',
    duration_seconds: row.duration_seconds ?? null,
    publication_status_code: row.publication_status_code,
    sort_order: row.sort_order ?? 0,
    is_essential: Boolean(row.is_essential),
    series_codes: [...new Set(seriesByMedia.get(String(row.id)) || [])].sort(),
    work_ids: [...new Set(worksByMedia.get(String(row.id)) || [])].sort(),
  }));

  return {
    ok: true,
    media_types: typesRes.data || [],
    items,
  };
}

async function fetchEvents(supabase: SupabaseClient) {
  const [typesRes, rolesRes, eventsRes, linksRes, mediaRes] = await Promise.all([
    supabase.from('event_types').select('code, label, sort_order').order('sort_order', { ascending: true }),
    supabase.from('event_roles').select('code, label, sort_order').order('sort_order', { ascending: true }),
    supabase
      .from('artist_events')
      .select(
        'id, event_type_code, role_code, date_label, sort_date, sort_date_end, label, note, publication_status_code, sort_order'
      )
      .in('publication_status_code', PUBLIC_STATUSES)
      .order('sort_date', { ascending: false })
      .order('sort_order', { ascending: true }),
    supabase.from('artist_event_media').select('event_id, media_id'),
    supabase
      .from('related_media')
      .select('id, media_type_code, title, url, file_path, internal_path')
      .in('publication_status_code', PUBLIC_STATUSES),
  ]);

  if (typesRes.error) throw typesRes.error;
  if (rolesRes.error) throw rolesRes.error;
  if (eventsRes.error) throw eventsRes.error;
  if (linksRes.error) throw linksRes.error;
  if (mediaRes.error) throw mediaRes.error;

  const mediaById = new Map<string, Record<string, unknown>>();
  for (const row of mediaRes.data || []) {
    mediaById.set(String(row.id), {
      id: row.id,
      media_type_code: row.media_type_code,
      title: row.title || '',
      url: row.url || '',
      file_path: row.file_path || '',
      internal_path: row.internal_path || '',
    });
  }

  const mediaByEvent = new Map<string, Array<Record<string, unknown>>>();
  for (const link of linksRes.data || []) {
    const eventId = String(link.event_id);
    const media = mediaById.get(String(link.media_id));
    if (!media) continue;
    const list = mediaByEvent.get(eventId) || [];
    list.push(media);
    mediaByEvent.set(eventId, list);
  }

  const items = (eventsRes.data || []).map((row) => {
    const media = [...(mediaByEvent.get(String(row.id)) || [])].sort((a, b) =>
      String(a.title).localeCompare(String(b.title), 'fr')
    );
    return {
      id: row.id,
      event_type_code: row.event_type_code,
      role_code: row.role_code,
      date_label: row.date_label || '',
      sort_date: row.sort_date,
      sort_date_end: row.sort_date_end,
      label: row.label || '',
      note: row.note || '',
      publication_status_code: row.publication_status_code,
      sort_order: row.sort_order ?? 0,
      media_ids: media.map((m) => m.id),
      media,
    };
  });

  return {
    ok: true,
    event_types: typesRes.data || [],
    event_roles: rolesRes.data || [],
    items,
  };
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

  if (path === '/api/resources') {
    try {
      const supabase = createSupabase();
      const resources = await fetchResources(supabase);
      return jsonResponse(200, resources);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('public-site-api resources:', message);
      return jsonResponse(500, { ok: false, error: message });
    }
  }

  if (path === '/api/events') {
    try {
      const supabase = createSupabase();
      const events = await fetchEvents(supabase);
      return jsonResponse(200, events);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('public-site-api events:', message);
      return jsonResponse(500, { ok: false, error: message });
    }
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
