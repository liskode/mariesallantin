/**
 * Chargement des événements parcours : Edge Function → Supabase direct → events-data.js
 */
(function (global) {
  const PUBLIC_STATUSES = ['W', 'G'];
  const CONFIG_URLS = ['../media/collectors-config.json', '../../media/collectors-config.json'];

  let cache = null;
  let configCache = null;

  function normalizeMedia(row) {
    return {
      id: String(row.id || '').trim(),
      media_type_code: String(row.media_type_code || '').trim().toUpperCase(),
      title: String(row.title || '').trim(),
      url: String(row.url || '').trim(),
      file_path: String(row.file_path || '').trim(),
      internal_path: String(row.internal_path || '').trim(),
    };
  }

  function normalizeItem(row, mediaByEvent) {
    const id = String(row.id || '').trim();
    const media = mediaByEvent.get(id) || [];
    return {
      id,
      event_type_code: String(row.event_type_code || '').trim().toUpperCase(),
      role_code: String(row.role_code || '').trim().toUpperCase(),
      date_label: String(row.date_label || '').trim(),
      sort_date: row.sort_date || null,
      sort_date_end: row.sort_date_end || null,
      label: String(row.label || '').trim(),
      note: String(row.note || '').trim(),
      publication_status_code: String(row.publication_status_code || 'N').trim().toUpperCase(),
      sort_order: row.sort_order != null ? Number(row.sort_order) : 0,
      media_ids: media.map((m) => m.id),
      media,
    };
  }

  function buildPayload(eventTypes, eventRoles, items) {
    return {
      event_types: (eventTypes || []).map((t) => ({
        code: String(t.code).trim(),
        label: String(t.label || t.code).trim(),
        sort_order: t.sort_order != null ? Number(t.sort_order) : 0,
      })),
      event_roles: (eventRoles || []).map((r) => ({
        code: String(r.code).trim(),
        label: String(r.label || r.code).trim(),
        sort_order: r.sort_order != null ? Number(r.sort_order) : 0,
      })),
      items: (items || [])
        .filter((item) => PUBLIC_STATUSES.includes(item.publication_status_code))
        .sort(
          (a, b) =>
            String(b.sort_date || '').localeCompare(String(a.sort_date || '')) ||
            a.sort_order - b.sort_order
        ),
    };
  }

  function linksMaps(linkRows, mediaRows) {
    const mediaById = new Map();
    (mediaRows || []).forEach((row) => {
      mediaById.set(String(row.id), normalizeMedia(row));
    });
    const mediaByEvent = new Map();
    (linkRows || []).forEach((row) => {
      const eventId = String(row.event_id);
      const media = mediaById.get(String(row.media_id));
      if (!media) return;
      if (!mediaByEvent.has(eventId)) mediaByEvent.set(eventId, []);
      mediaByEvent.get(eventId).push(media);
    });
    for (const list of mediaByEvent.values()) {
      list.sort((a, b) => a.title.localeCompare(b.title, 'fr'));
    }
    return { mediaByEvent };
  }

  async function loadConfig() {
    if (configCache) return configCache;
    let lastErr = null;
    for (const url of CONFIG_URLS) {
      try {
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) continue;
        configCache = await r.json();
        return configCache;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('Impossible de charger collectors-config.json');
  }

  async function fetchEventsApi(cfg) {
    const apiUrl = String(cfg.publicSiteApiUrl || '').trim();
    if (!apiUrl) return null;
    const r = await fetch(apiUrl.replace(/\/$/, '') + '/api/events', { cache: 'no-store' });
    if (!r.ok) return null;
    const data = await r.json();
    if (!data || data.ok === false || !Array.isArray(data.items)) return null;
    return buildPayload(data.event_types, data.event_roles, data.items);
  }

  async function fetchEventsDirect(cfg) {
    const base = String(cfg.supabaseUrl || '').replace(/\/$/, '');
    const key = String(cfg.anonKey || '').trim();
    if (!base || !key) throw new Error('supabaseUrl / anonKey manquants');

    const headers = { apikey: key, Authorization: 'Bearer ' + key };
    const statusFilter = 'publication_status_code=in.(' + PUBLIC_STATUSES.join(',') + ')';
    const eventSelect =
      'id,event_type_code,role_code,date_label,sort_date,sort_date_end,label,note,publication_status_code,sort_order';
    const mediaSelect = 'id,media_type_code,title,url,file_path,internal_path';

    const [typesRes, rolesRes, eventsRes, linksRes, mediaRes] = await Promise.all([
      fetch(base + '/rest/v1/event_types?select=code,label,sort_order&order=sort_order.asc', {
        headers,
        cache: 'no-store',
      }),
      fetch(base + '/rest/v1/event_roles?select=code,label,sort_order&order=sort_order.asc', {
        headers,
        cache: 'no-store',
      }),
      fetch(
        base +
          '/rest/v1/artist_events?select=' +
          eventSelect +
          '&' +
          statusFilter +
          '&order=sort_date.desc,sort_order.asc',
        { headers, cache: 'no-store' }
      ),
      fetch(base + '/rest/v1/artist_event_media?select=event_id,media_id', {
        headers,
        cache: 'no-store',
      }),
      fetch(
        base +
          '/rest/v1/related_media?select=' +
          mediaSelect +
          '&' +
          statusFilter,
        { headers, cache: 'no-store' }
      ),
    ]);

    if (!typesRes.ok) throw new Error('Lecture event_types : ' + typesRes.status);
    if (!rolesRes.ok) throw new Error('Lecture event_roles : ' + rolesRes.status);
    if (!eventsRes.ok) throw new Error('Lecture artist_events : ' + eventsRes.status);
    if (!linksRes.ok) throw new Error('Lecture artist_event_media : ' + linksRes.status);
    if (!mediaRes.ok) throw new Error('Lecture related_media : ' + mediaRes.status);

    const { mediaByEvent } = linksMaps(await linksRes.json(), await mediaRes.json());
    const items = (await eventsRes.json()).map((row) => normalizeItem(row, mediaByEvent));
    return buildPayload(await typesRes.json(), await rolesRes.json(), items);
  }

  function fallbackStatic() {
    if (!global.EventsData) throw new Error('events-data.js manquant');
    const { mediaByEvent } = linksMaps([], []);
    const items = (global.EventsData.items || []).map((row) => normalizeItem(row, mediaByEvent));
    return buildPayload(global.EventsData.event_types, global.EventsData.event_roles, items);
  }

  async function load() {
    if (cache) return cache;
    try {
      const cfg = await loadConfig();
      const fromApi = await fetchEventsApi(cfg);
      if (fromApi && fromApi.items.length) {
        cache = fromApi;
        return cache;
      }
      try {
        cache = await fetchEventsDirect(cfg);
        if (cache.items.length) return cache;
      } catch (e) {
        console.warn('Repli Supabase événements indisponible', e);
      }
    } catch (e) {
      console.warn('Chargement événements via API/config', e);
    }
    cache = fallbackStatic();
    return cache;
  }

  function displayDate(item) {
    const label = String(item.date_label || '').trim();
    if (label) return label;
    const d = String(item.sort_date || '').trim();
    if (!d) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      const [y, m, day] = d.split('-');
      return day === '01' && m === '01' ? y : new Date(d + 'T12:00:00').toLocaleDateString('fr-FR');
    }
    return d;
  }

  global.SiteEvents = {
    load,
    displayDate,
  };
})(typeof window !== 'undefined' ? window : globalThis);
