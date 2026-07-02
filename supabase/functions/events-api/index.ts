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
  const prefixes = ['/events-api', '/functions/v1/events-api'];
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

function normalizeEventInput(raw: Record<string, unknown>) {
  const id = String(raw.id || '').trim();

  return {
    id,
    event_type_code: String(raw.event_type_code || 'P').trim().toUpperCase(),
    date_label: String(raw.date_label || '').trim(),
    label: String(raw.label || '').trim(),
    note: String(raw.note || '').trim(),
    publication_status_code: String(raw.publication_status_code || 'N')
      .trim()
      .toUpperCase(),
    sort_order: Number.isFinite(Number(raw.sort_order)) ? Number(raw.sort_order) : 0,
    media_ids: Array.isArray(raw.media_ids)
      ? [...new Set(raw.media_ids.map((m) => String(m).trim()).filter(Boolean))]
      : [],
  };
}

async function fetchEditorPayload(supabase: SupabaseClient) {
  const [typesRes, statusesRes, eventsRes, linksRes, mediaRes] = await Promise.all([
    supabase.from('event_types').select('code, label, sort_order').order('sort_order', { ascending: true }),
    supabase.from('publication_statuses').select('code, label, sort_order').order('sort_order', { ascending: true }),
    supabase
      .from('artist_events')
      .select(
        'id, event_type_code, date_label, label, note, publication_status_code, sort_order, created_at, updated_at'
      )
      .order('sort_order', { ascending: true }),
    supabase.from('artist_event_media').select('event_id, media_id'),
    supabase
      .from('related_media')
      .select('id, title, media_type_code, publication_status_code')
      .order('sort_order', { ascending: true })
      .order('title', { ascending: true }),
  ]);

  if (typesRes.error) throw typesRes.error;
  if (statusesRes.error) throw statusesRes.error;
  if (eventsRes.error) throw eventsRes.error;
  if (linksRes.error) throw linksRes.error;
  if (mediaRes.error) throw mediaRes.error;

  const mediaByEvent = new Map<string, string[]>();
  for (const row of linksRes.data || []) {
    const eventId = String(row.event_id);
    const list = mediaByEvent.get(eventId) || [];
    list.push(String(row.media_id));
    mediaByEvent.set(eventId, list);
  }

  const items = (eventsRes.data || []).map((row) => ({
    ...row,
    media_ids: [...new Set(mediaByEvent.get(String(row.id)) || [])].sort(),
  }));

  return {
    event_types: typesRes.data || [],
    publication_statuses: statusesRes.data || [],
    media_options: mediaRes.data || [],
    items,
  };
}

async function syncMediaLinks(
  supabase: SupabaseClient,
  eventId: string,
  mediaIds: string[]
) {
  const { error: delErr } = await supabase.from('artist_event_media').delete().eq('event_id', eventId);
  if (delErr) throw delErr;
  if (!mediaIds.length) return;
  const rows = mediaIds.map((media_id) => ({ event_id: eventId, media_id }));
  const { error: insErr } = await supabase.from('artist_event_media').insert(rows);
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
      return jsonResponse(200, { ok: true, service: 'events-api' });
    }

    if (req.method === 'GET' && path === '/api/events') {
      const token = url.searchParams.get('token') || '';
      if (!checkToken(token)) {
        return jsonResponse(403, { ok: false, error: 'token incorrect' });
      }
      const supabase = createSupabase();
      const payload = await fetchEditorPayload(supabase);
      return jsonResponse(200, { ok: true, ...payload });
    }

    if (req.method === 'POST' && path === '/api/events/create') {
      const body = await req.json();
      if (!checkToken(String(body.token || ''))) {
        return jsonResponse(403, { ok: false, error: 'token incorrect' });
      }
      const supabase = createSupabase();
      const { data: last } = await supabase
        .from('artist_events')
        .select('sort_order')
        .order('sort_order', { ascending: false })
        .limit(1)
        .maybeSingle();
      const sort_order = (last?.sort_order ?? 0) + 10;
      const year = new Date().getFullYear();
      const { error } = await supabase.from('artist_events').insert({
        event_type_code: 'P',
        date_label: String(year),
        label: 'Nouvel événement',
        note: '',
        publication_status_code: 'N',
        sort_order,
      });
      if (error) throw error;
      const payload = await fetchEditorPayload(supabase);
      return jsonResponse(200, { ok: true, ...payload });
    }

    if (req.method === 'POST' && path === '/api/events/save') {
      const body = await req.json();
      if (!checkToken(String(body.token || ''))) {
        return jsonResponse(403, { ok: false, error: 'token incorrect' });
      }
      const rows = Array.isArray(body.items) ? body.items : [];
      if (!rows.length) {
        return jsonResponse(400, { ok: false, error: 'aucun événement à enregistrer' });
      }

      const supabase = createSupabase();
      const normalized = rows.map((r: Record<string, unknown>) => {
        const item = normalizeEventInput(r);
        if (!item.id) throw new Error('id manquant');
        if (!item.date_label) throw new Error('date affichée manquante pour ' + item.id);
        if (!item.label) throw new Error('libellé manquant pour ' + item.id);
        return item;
      });

      for (const item of normalized) {
        const { media_ids, ...row } = item;
        const { error } = await supabase.from('artist_events').upsert(row, { onConflict: 'id' });
        if (error) throw error;
        await syncMediaLinks(supabase, row.id, media_ids);
      }

      const payload = await fetchEditorPayload(supabase);
      return jsonResponse(200, { ok: true, ...payload });
    }

    if (req.method === 'DELETE' && path.startsWith('/api/events/')) {
      const id = decodeURIComponent(path.slice('/api/events/'.length)).trim();
      const token = url.searchParams.get('token') || '';
      if (!checkToken(token)) {
        return jsonResponse(403, { ok: false, error: 'token incorrect' });
      }
      if (!id) {
        return jsonResponse(400, { ok: false, error: 'id manquant' });
      }
      const supabase = createSupabase();
      const { error } = await supabase.from('artist_events').delete().eq('id', id);
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
