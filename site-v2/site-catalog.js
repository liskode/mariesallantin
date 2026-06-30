/**
 * Catalogue public site-v2 : œuvres W/G depuis Supabase (Edge Function ou repli direct).
 * Expose la même interface que WorksCatalog pour gallery.js.
 */
(function (global) {
  const MEDIA_PREFIX = '../media/';
  const CONFIG_URL = '../media/collectors-config.json';
  let cache = null;
  let configCache = null;
  let workMediaById = null;

  function uniqSeriesCodes(codes) {
    const out = [];
    const seen = new Set();
    (codes || []).forEach((c) => {
      const x = String(c).trim();
      if (!x || seen.has(x)) return;
      seen.add(x);
      out.push(x);
    });
    return out;
  }

  async function loadWorksJsonMediaMap() {
    if (workMediaById) return workMediaById;
    workMediaById = new Map();
    try {
      const r = await fetch(MEDIA_PREFIX + 'works.json', { cache: 'no-store' });
      if (!r.ok) return workMediaById;
      const j = await r.json();
      for (const w of j.works || []) {
        if (!w.id || !w.media) continue;
        const media = String(w.media).trim().replace(/\\/g, '/').replace(/^media\//, '');
        if (media) workMediaById.set(String(w.id).trim().toUpperCase(), media);
      }
    } catch (e) {
      console.warn('works.json (chemins media) indisponible', e);
    }
    return workMediaById;
  }

  /** Même logique que works-editor.js : works.json → filename_original → MS####.ext */
  function mediaPathForWork(id, imageExt, filenameOriginal, mediaMap) {
    const workId = String(id || '').trim().toUpperCase();
    if (mediaMap && mediaMap.has(workId)) return mediaMap.get(workId);
    const orig = String(filenameOriginal || '').trim().replace(/\\/g, '/');
    if (orig) {
      if (orig.includes('/')) return orig.replace(/^media\//, '');
      if (orig.toUpperCase().startsWith(workId)) return 'catalogue/' + orig;
    }
    const ext = String(imageExt || 'jpeg').replace(/^\./, '').toLowerCase() || 'jpeg';
    return 'catalogue/' + workId + '.' + ext;
  }

  async function loadConfig() {
    if (configCache) return configCache;
    const r = await fetch(CONFIG_URL, { cache: 'no-store' });
    if (!r.ok) throw new Error('Impossible de charger collectors-config.json');
    configCache = await r.json();
    return configCache;
  }

  async function fetchCatalogPayload() {
    const cfg = await loadConfig();
    const apiUrl = String(cfg.publicSiteApiUrl || '').trim();
    if (apiUrl) {
      const url = apiUrl.replace(/\/$/, '') + '/api/catalog';
      const r = await fetch(url, { cache: 'no-store' });
      if (r.ok) {
        const data = await r.json();
        if (data && data.ok !== false && Array.isArray(data.works)) return data;
      }
      console.warn('public-site-api indisponible, repli Supabase direct');
    }
    return fetchCatalogDirect(cfg);
  }

  async function fetchCatalogDirect(cfg) {
    const base = String(cfg.supabaseUrl || '').replace(/\/$/, '');
    const key = String(cfg.anonKey || '').trim();
    if (!base || !key) throw new Error('supabaseUrl / anonKey manquants dans la config');

    const headers = {
      apikey: key,
      Authorization: 'Bearer ' + key,
    };
    const qs =
      'select=id,title,year,image_ext,filename_original,publication_status_code,sort_order,format_code,technique_code' +
      '&publication_status_code=in.(W,G)&order=sort_order.asc,id.asc';
    const worksRes = await fetch(base + '/rest/v1/works?' + qs, { headers, cache: 'no-store' });
    if (!worksRes.ok) throw new Error('Lecture works Supabase : ' + worksRes.status);

    const worksRaw = await worksRes.json();
    const publicIds = new Set(worksRaw.map((w) => w.id));

    const [seriesRes, linksRes] = await Promise.all([
      fetch(
        base + '/rest/v1/series?select=code,label,sort_order,icon_work_id&order=sort_order.asc,code.asc',
        { headers, cache: 'no-store' }
      ),
      fetch(base + '/rest/v1/work_series?select=work_id,series_code', { headers, cache: 'no-store' }),
    ]);
    if (!seriesRes.ok) throw new Error('Lecture series Supabase : ' + seriesRes.status);
    if (!linksRes.ok) throw new Error('Lecture work_series Supabase : ' + linksRes.status);

    const linksRaw = await linksRes.json();
    const seriesCodesWithWorks = new Set();
    const linksByWork = new Map();
    for (const link of linksRaw) {
      if (!publicIds.has(link.work_id)) continue;
      const list = linksByWork.get(link.work_id) || [];
      list.push(link.series_code);
      linksByWork.set(link.work_id, list);
      seriesCodesWithWorks.add(link.series_code);
    }

    const works = worksRaw.map((w) => ({
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

    const seriesAll = await seriesRes.json();
    const visibleSeries = seriesAll.filter((s) => seriesCodesWithWorks.has(s.code));
    const missingIconIds = [
      ...new Set(
        visibleSeries
          .map((s) => s.icon_work_id)
          .filter((id) => id && !publicIds.has(id))
      ),
    ];

    let iconWorks = [];
    if (missingIconIds.length) {
      const iconQs =
        'select=id,title,image_ext,filename_original&id=in.(' + missingIconIds.join(',') + ')';
      const iconRes = await fetch(base + '/rest/v1/works?' + iconQs, { headers, cache: 'no-store' });
      if (iconRes.ok) {
        iconWorks = await iconRes.json();
      }
    }

    const series = visibleSeries.map((s) => ({
      code: s.code,
      label: s.label || s.code,
      sort_order: s.sort_order ?? 0,
      icon_work_id: s.icon_work_id || null,
    }));

    return { ok: true, series, works, icon_works: iconWorks };
  }

  function buildFromPayload(payload, mediaMap) {
    const seriesOrder = [];
    const seriesNames = {};
    const seriesIconWorkIds = {};
    const allSeries = {};

    (payload.series || [])
      .slice()
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || String(a.code).localeCompare(String(b.code)))
      .forEach((s) => {
        const code = String(s.code).trim();
        if (!code) return;
        seriesOrder.push(code);
        seriesNames[code] = String(s.label || code).trim();
        allSeries[code] = [];
        if (s.icon_work_id) seriesIconWorkIds[code] = s.icon_work_id;
      });

    const works = (payload.works || []).map((w) => {
      const id = String(w.id).trim();
      const media = mediaPathForWork(id, w.image_ext, w.filename_original, mediaMap);
      const series = uniqSeriesCodes(w.series_codes || []);
      return {
        id,
        media,
        title: String(w.title || '').trim(),
        series,
        photo: 'OK',
        publish: w.publication_status_code === 'G' ? 'G' : 'ON',
        publication_status_code: w.publication_status_code,
        dimensions: '',
        tailleMo: null,
        format: w.format_code != null ? String(w.format_code).trim().toUpperCase() : '',
        year: w.year != null ? String(w.year).trim() : '',
        technique: w.technique_code != null ? String(w.technique_code).trim().toUpperCase() : '',
        sort_order: w.sort_order ?? 0,
      };
    });

    works.forEach((w) => {
      const item = {
        id: w.id,
        filePath: w.media,
        title: w.title,
        photo: w.photo,
        publish: w.publish,
        dimensions: w.dimensions,
        tailleMo: w.tailleMo,
        format: w.format,
        year: w.year,
        technique: w.technique,
        sort_order: w.sort_order,
      };
      w.series.forEach((code) => {
        if (!allSeries[code]) {
          allSeries[code] = [];
          if (!seriesOrder.includes(code)) seriesOrder.push(code);
          seriesNames[code] = seriesNames[code] || code;
        }
        allSeries[code].push(item);
      });
    });

    const filteredOrder = seriesOrder.filter((code) => allSeries[code] && allSeries[code].length);
    Object.keys(allSeries).forEach((code) => {
      allSeries[code].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.id.localeCompare(b.id));
    });

    const galleryWorks = works.filter((w) => w.publication_status_code === 'G');

    const workById = new Map(works.map((w) => [w.id, w]));
    const seriesIconCovers = {};
    (payload.series || []).forEach((s) => {
      const code = String(s.code || '').trim();
      const iconId = String(s.icon_work_id || '').trim();
      if (!code || !iconId) return;
      seriesIconWorkIds[code] = iconId;
      const published = workById.get(iconId);
      if (published) {
        seriesIconCovers[code] = {
          id: iconId,
          filePath: published.media,
          title: published.title,
        };
        return;
      }
      const extra = (payload.icon_works || []).find((w) => String(w.id).trim() === iconId);
      if (extra) {
        seriesIconCovers[code] = {
          id: iconId,
          filePath: mediaPathForWork(iconId, extra.image_ext, extra.filename_original, mediaMap),
          title: String(extra.title || iconId).trim(),
        };
      }
    });

    return {
      seriesOrder: filteredOrder,
      seriesNames,
      allSeries,
      works,
      galleryWorks,
      seriesIconWorkIds,
      seriesIconCovers,
    };
  }

  function getSeriesCounts(works, seriesOrder) {
    const counts = {};
    seriesOrder.forEach((c) => {
      counts[c] = 0;
    });
    works.forEach((w) => {
      w.series.forEach((c) => {
        if (counts[c] !== undefined) counts[c]++;
      });
    });
    return counts;
  }

  function buildMediaUrl(mediaRelativePath) {
    const p = String(mediaRelativePath || '')
      .trim()
      .replace(/\\/g, '/');
    if (!p) return '';
    const withoutMedia = p.replace(/^media\//, '');
    const full = MEDIA_PREFIX + withoutMedia;
    return full
      .split('/')
      .map((seg, i) =>
        i === 0 ? seg : encodeURIComponent(String(seg).normalize('NFC'))
      )
      .join('/');
  }

  async function load() {
    if (cache) return cache;
    const [payload, mediaMap] = await Promise.all([fetchCatalogPayload(), loadWorksJsonMediaMap()]);
    cache = buildFromPayload(payload, mediaMap);
    return cache;
  }

  function clearCache() {
    cache = null;
    configCache = null;
    workMediaById = null;
  }

  const SiteCatalog = {
    load,
    clearCache,
    getSeriesCounts,
    buildMediaUrl,
    buildFromPayload,
    mediaPathForWork,
  };

  global.SiteCatalog = SiteCatalog;
  global.WorksCatalog = SiteCatalog;
})(typeof window !== 'undefined' ? window : this);
