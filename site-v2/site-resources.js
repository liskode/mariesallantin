/**
 * Chargement des ressources site public : Edge Function → Supabase direct → resources-data.js
 */
(function (global) {
  const PUBLIC_STATUSES = ['W', 'G'];
  const CONFIG_URLS = ['../media/collectors-config.json', '../../media/collectors-config.json'];

  let cache = null;
  let configCache = null;

  function siteAssetPrefix() {
    const path = window.location.pathname || '';
    if (/\/site-v2\/pages\//.test(path)) return '../../';
    if (path.includes('/site-v2')) return '../';
    return '';
  }

  function mediaPrefix() {
    const path = window.location.pathname || '';
    if (/\/site-v2\/pages\//.test(path)) return '../../media/';
    if (path.includes('/site-v2')) return '../media/';
    return 'media/';
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

  function normalizeItem(row, seriesByMedia, worksByMedia) {
    const id = String(row.id || '').trim();
    return {
      id,
      media_type_code: String(row.media_type_code || '').trim().toUpperCase(),
      title: String(row.title || '').trim(),
      media_date: row.media_date || null,
      source: String(row.source || '').trim(),
      description: String(row.description || '').trim(),
      url: String(row.url || '').trim(),
      thumbnail_path: String(row.thumbnail_path || '').trim(),
      file_path: String(row.file_path || '').trim(),
      internal_path: String(row.internal_path || '').trim(),
      duration_seconds: row.duration_seconds != null ? Number(row.duration_seconds) : null,
      publication_status_code: String(row.publication_status_code || 'N').trim().toUpperCase(),
      sort_order: row.sort_order != null ? Number(row.sort_order) : 0,
      series_codes: [...(seriesByMedia.get(id) || [])].sort(),
      work_ids: [...(worksByMedia.get(id) || [])].sort(),
    };
  }

  function buildPayload(mediaTypes, items) {
    return {
      media_types: (mediaTypes || []).map((t) => ({
        code: String(t.code).trim(),
        label: String(t.label || t.code).trim(),
        sort_order: t.sort_order != null ? Number(t.sort_order) : 0,
      })),
      items: (items || [])
        .filter((item) => PUBLIC_STATUSES.includes(item.publication_status_code))
        .sort((a, b) => a.sort_order - b.sort_order || String(b.media_date || '').localeCompare(String(a.media_date || ''))),
    };
  }

  function linksMaps(seriesRows, workRows) {
    const seriesByMedia = new Map();
    const worksByMedia = new Map();
    (seriesRows || []).forEach((row) => {
      const id = String(row.media_id);
      const code = String(row.series_code).trim();
      if (!seriesByMedia.has(id)) seriesByMedia.set(id, []);
      seriesByMedia.get(id).push(code);
    });
    (workRows || []).forEach((row) => {
      const id = String(row.media_id);
      const workId = String(row.work_id).trim();
      if (!worksByMedia.has(id)) worksByMedia.set(id, []);
      worksByMedia.get(id).push(workId);
    });
    return { seriesByMedia, worksByMedia };
  }

  async function fetchResourcesApi(cfg) {
    const apiUrl = String(cfg.publicSiteApiUrl || '').trim();
    if (!apiUrl) return null;
    const r = await fetch(apiUrl.replace(/\/$/, '') + '/api/resources', { cache: 'no-store' });
    if (!r.ok) return null;
    const data = await r.json();
    if (!data || data.ok === false || !Array.isArray(data.items)) return null;
    return buildPayload(data.media_types, data.items);
  }

  async function fetchResourcesDirect(cfg) {
    const base = String(cfg.supabaseUrl || '').replace(/\/$/, '');
    const key = String(cfg.anonKey || '').trim();
    if (!base || !key) throw new Error('supabaseUrl / anonKey manquants');

    const headers = { apikey: key, Authorization: 'Bearer ' + key };
    const statusFilter = 'publication_status_code=in.(' + PUBLIC_STATUSES.join(',') + ')';
    const select =
      'id,media_type_code,title,media_date,source,description,url,thumbnail_path,file_path,internal_path,duration_seconds,publication_status_code,sort_order';

    const [typesRes, mediaRes, seriesRes, worksRes] = await Promise.all([
      fetch(base + '/rest/v1/media_types?select=code,label,sort_order&order=sort_order.asc', {
        headers,
        cache: 'no-store',
      }),
      fetch(
        base +
          '/rest/v1/related_media?select=' +
          select +
          '&' +
          statusFilter +
          '&order=sort_order.asc,media_date.desc',
        { headers, cache: 'no-store' }
      ),
      fetch(base + '/rest/v1/related_media_series?select=media_id,series_code', {
        headers,
        cache: 'no-store',
      }),
      fetch(base + '/rest/v1/related_media_works?select=media_id,work_id', {
        headers,
        cache: 'no-store',
      }),
    ]);

    if (!typesRes.ok) throw new Error('Lecture media_types : ' + typesRes.status);
    if (!mediaRes.ok) throw new Error('Lecture related_media : ' + mediaRes.status);
    if (!seriesRes.ok) throw new Error('Lecture related_media_series : ' + seriesRes.status);
    if (!worksRes.ok) throw new Error('Lecture related_media_works : ' + worksRes.status);

    const { seriesByMedia, worksByMedia } = linksMaps(await seriesRes.json(), await worksRes.json());
    const items = (await mediaRes.json()).map((row) => normalizeItem(row, seriesByMedia, worksByMedia));
    return buildPayload(await typesRes.json(), items);
  }

  function fallbackStatic() {
    if (!global.ResourcesData) throw new Error('resources-data.js manquant');
    return buildPayload(global.ResourcesData.media_types, global.ResourcesData.items);
  }

  async function load() {
    if (cache) return cache;
    try {
      const cfg = await loadConfig();
      const fromApi = await fetchResourcesApi(cfg);
      if (fromApi && fromApi.items.length) {
        cache = fromApi;
        return cache;
      }
      try {
        cache = await fetchResourcesDirect(cfg);
        if (cache.items.length) return cache;
      } catch (e) {
        console.warn('Repli Supabase ressources indisponible', e);
      }
    } catch (e) {
      console.warn('Chargement ressources via API/config', e);
    }
    cache = fallbackStatic();
    return cache;
  }

  function resolveAssetPath(relativePath) {
    const p = String(relativePath || '').trim();
    if (!p) return '';
    if (/^https?:\/\//i.test(p)) return p;
    return siteAssetPrefix() + p.replace(/^\//, '');
  }

  function resolveMediaPath(relativePath) {
    const p = String(relativePath || '').trim();
    if (!p) return '';
    if (/^https?:\/\//i.test(p)) return p;
    const clean = p.replace(/^media\//, '');
    return mediaPrefix() + clean;
  }

  function resolveInternalPath(relativePath) {
    const p = String(relativePath || '').trim();
    if (!p) return '';
    const pathname = window.location.pathname || '';
    if (/\/site-v2\/pages\//.test(pathname)) {
      return p.replace(/^pages\//, '');
    }
    if (pathname.includes('/site-v2')) {
      return p.startsWith('pages/') ? p : 'pages/' + p;
    }
    return p;
  }

  global.SiteResources = {
    load,
    resolveAssetPath,
    resolveMediaPath,
    resolveInternalPath,
    siteAssetPrefix,
  };
})(typeof window !== 'undefined' ? window : globalThis);
