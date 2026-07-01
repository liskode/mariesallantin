/**
 * Catalogue public site-v2 : œuvres W/G depuis Supabase (Edge Function ou repli direct).
 * Expose la même interface que WorksCatalog pour gallery.js.
 */
(function (global) {
  function mediaPrefix() {
    const path = window.location.pathname || '';
    if (/\/site-v2\/pages\//.test(path)) return '../../media/';
    if (path.includes('/site-v2')) return '../media/';
    return 'media/';
  }

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
      const r = await fetch(mediaPrefix() + 'works.json', { cache: 'no-store' });
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
    const r = await fetch(mediaPrefix() + 'collectors-config.json', { cache: 'no-store' });
    if (!r.ok) throw new Error('Impossible de charger collectors-config.json');
    configCache = await r.json();
    return configCache;
  }

  async function fetchCodeTables(cfg) {
    const base = String(cfg.supabaseUrl || '').replace(/\/$/, '');
    const key = String(cfg.anonKey || '').trim();
    const headers = { apikey: key, Authorization: 'Bearer ' + key };
    const [formatsRes, techniquesRes] = await Promise.all([
      fetch(base + '/rest/v1/formats?select=code,label,width_cm,height_cm&order=sort_order.asc', {
        headers,
        cache: 'no-store',
      }),
      fetch(base + '/rest/v1/techniques?select=code,label&order=sort_order.asc', {
        headers,
        cache: 'no-store',
      }),
    ]);
    if (!formatsRes.ok || !techniquesRes.ok) {
      throw new Error('Lecture formats/techniques Supabase');
    }
    return {
      formats: await formatsRes.json(),
      techniques: await techniquesRes.json(),
    };
  }

  async function enrichPayloadCodeTables(payload, cfg) {
    const needsFormats = !Array.isArray(payload.formats) || !payload.formats.length;
    const needsTechniques = !Array.isArray(payload.techniques) || !payload.techniques.length;
    if (!needsFormats && !needsTechniques) return payload;
    try {
      const tables = await fetchCodeTables(cfg);
      if (needsFormats) payload.formats = tables.formats;
      if (needsTechniques) payload.techniques = tables.techniques;
    } catch (e) {
      console.warn('Complément formats/techniques indisponible', e);
    }
    return payload;
  }

  async function enrichPayloadSeriesMeta(payload, cfg) {
    if (!Array.isArray(payload.series) || !payload.series.length) return payload;
    const needsMeta = payload.series.some((s) => s.description == null || s.description === undefined);
    if (!needsMeta) return payload;
    const base = String(cfg.supabaseUrl || '').replace(/\/$/, '');
    const key = String(cfg.anonKey || '').trim();
    if (!base || !key) return payload;
    try {
      const headers = { apikey: key, Authorization: 'Bearer ' + key };
      const r = await fetch(
        base + '/rest/v1/series?select=code,description,year_start,year_end',
        { headers, cache: 'no-store' }
      );
      if (!r.ok) return payload;
      const rows = await r.json();
      const byCode = new Map(
        rows.map((s) => [
          String(s.code).trim(),
          {
            description: String(s.description || '').trim(),
            year_start: s.year_start ?? null,
            year_end: s.year_end ?? null,
          },
        ])
      );
      payload.series = payload.series.map((s) => {
        const code = String(s.code).trim();
        const extra = byCode.get(code);
        if (!extra) return s;
        return {
          ...s,
          description: s.description != null ? String(s.description).trim() : extra.description,
          year_start: s.year_start ?? extra.year_start,
          year_end: s.year_end ?? extra.year_end,
        };
      });
    } catch (e) {
      console.warn('Complément descriptions séries indisponible', e);
    }
    return payload;
  }

  async function fetchCatalogPayload() {
    const cfg = await loadConfig();
    const apiUrl = String(cfg.publicSiteApiUrl || '').trim();
    if (apiUrl) {
      const url = apiUrl.replace(/\/$/, '') + '/api/catalog';
      const r = await fetch(url, { cache: 'no-store' });
      if (r.ok) {
        const data = await r.json();
        if (data && data.ok !== false && Array.isArray(data.works)) {
          const enriched = await enrichPayloadCodeTables(data, cfg);
          return enrichPayloadSeriesMeta(enriched, cfg);
        }
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

    const [seriesRes, linksRes, formatsRes, techniquesRes] = await Promise.all([
      fetch(
        base + '/rest/v1/series?select=code,label,sort_order,icon_work_id,year_start,year_end,description&order=sort_order.asc,code.asc',
        { headers, cache: 'no-store' }
      ),
      fetch(base + '/rest/v1/work_series?select=work_id,series_code', { headers, cache: 'no-store' }),
      fetch(base + '/rest/v1/formats?select=code,label,width_cm,height_cm&order=sort_order.asc', { headers, cache: 'no-store' }),
      fetch(base + '/rest/v1/techniques?select=code,label&order=sort_order.asc', { headers, cache: 'no-store' }),
    ]);
    if (!seriesRes.ok) throw new Error('Lecture series Supabase : ' + seriesRes.status);
    if (!linksRes.ok) throw new Error('Lecture work_series Supabase : ' + linksRes.status);
    if (!formatsRes.ok) throw new Error('Lecture formats Supabase : ' + formatsRes.status);
    if (!techniquesRes.ok) throw new Error('Lecture techniques Supabase : ' + techniquesRes.status);

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
      year_start: s.year_start ?? null,
      year_end: s.year_end ?? null,
      description: String(s.description || '').trim(),
    }));

    return {
      ok: true,
      series,
      works,
      icon_works: iconWorks,
      formats: await formatsRes.json(),
      techniques: await techniquesRes.json(),
    };
  }

  function formatCmValue(n) {
    const num = Number(n);
    if (!Number.isFinite(num) || num <= 0) return '';
    if (Math.abs(num - Math.round(num)) < 0.001) return String(Math.round(num));
    return num.toFixed(1).replace('.', ',');
  }

  function buildLabelMaps(payload) {
    const techniqueLabels = {};
    const formatDimensions = {};
    (payload.formats || []).forEach((f) => {
      const code = String(f.code || '').trim().toUpperCase();
      if (!code) return;
      formatDimensions[code] = {
        width_cm: f.width_cm != null ? Number(f.width_cm) : null,
        height_cm: f.height_cm != null ? Number(f.height_cm) : null,
      };
    });
    (payload.techniques || []).forEach((t) => {
      const code = String(t.code || '').trim().toUpperCase();
      if (code) techniqueLabels[code] = String(t.label || code).trim();
    });
    return { techniqueLabels, formatDimensions };
  }

  function formatSizeText(formatCode, formatDimensions) {
    if (!formatCode) return '';
    const dims = formatDimensions[formatCode];
    if (!dims) return '';
    const h = formatCmValue(dims.height_cm);
    const w = formatCmValue(dims.width_cm);
    if (!h || !w) return '';
    return h + ' x ' + w + ' cm';
  }

  function labelsForWork(w, techniqueLabels, formatDimensions) {
    const formatCode = w.format_code != null ? String(w.format_code).trim().toUpperCase() : '';
    const techniqueCode = w.technique_code != null ? String(w.technique_code).trim().toUpperCase() : '';
    return {
      formatSize: formatSizeText(formatCode, formatDimensions),
      techniqueLabel: techniqueCode ? techniqueLabels[techniqueCode] || '' : '',
    };
  }

  function buildFromPayload(payload, mediaMap) {
    const seriesOrder = [];
    const seriesNames = {};
    const seriesMeta = {};
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
        seriesMeta[code] = {
          year_start: s.year_start != null ? Number(s.year_start) : null,
          year_end: s.year_end != null ? Number(s.year_end) : null,
          description: String(s.description || '').trim(),
        };
        allSeries[code] = [];
        if (s.icon_work_id) seriesIconWorkIds[code] = s.icon_work_id;
      });

    const { techniqueLabels, formatDimensions } = buildLabelMaps(payload);

    const works = (payload.works || []).map((w) => {
      const id = String(w.id).trim();
      const media = mediaPathForWork(id, w.image_ext, w.filename_original, mediaMap);
      const series = uniqSeriesCodes(w.series_codes || []);
      const { formatSize, techniqueLabel } = labelsForWork(w, techniqueLabels, formatDimensions);
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
        formatSize,
        year: w.year != null && w.year !== '' ? String(w.year).trim() : '',
        technique: w.technique_code != null ? String(w.technique_code).trim().toUpperCase() : '',
        techniqueLabel,
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
        formatSize: w.formatSize,
        year: w.year,
        technique: w.technique,
        techniqueLabel: w.techniqueLabel,
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
      seriesMeta,
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
    const full = mediaPrefix() + withoutMedia;
    return full
      .split('/')
      .map((seg, i) =>
        i === 0 ? seg : encodeURIComponent(String(seg).normalize('NFC'))
      )
      .join('/');
  }

  const RASTER_IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.avif']);

  /** Chemin relatif miniature WebP (catalogue/_thumbs/…) ou null. */
  function webThumbRelFromMediaFp(mediaFp) {
    const fp = String(mediaFp || '')
      .trim()
      .replace(/\\/g, '/');
    if (!fp.toLowerCase().startsWith('catalogue/')) return null;
    const rest = fp.slice('catalogue/'.length);
    const lastSlash = rest.lastIndexOf('/');
    const filePart = lastSlash >= 0 ? rest.slice(lastSlash + 1) : rest;
    const lastDot = filePart.lastIndexOf('.');
    const ext = lastDot >= 0 ? filePart.slice(lastDot).toLowerCase() : '';
    if (!RASTER_IMAGE_EXT.has(ext)) return null;
    const stem = filePart.replace(/\.[^.]+$/i, '');
    const dirPart = lastSlash >= 0 ? rest.slice(0, lastSlash) : '';
    return dirPart
      ? 'catalogue/_thumbs/' + dirPart + '/' + stem + '.webp'
      : 'catalogue/_thumbs/' + stem + '.webp';
  }

  function buildThumbUrl(mediaRelativePath) {
    const thumbRel = webThumbRelFromMediaFp(mediaRelativePath);
    return thumbRel ? buildMediaUrl(thumbRel) : buildMediaUrl(mediaRelativePath);
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
    buildThumbUrl,
    buildFromPayload,
    mediaPathForWork,
  };

  global.SiteCatalog = SiteCatalog;
  global.WorksCatalog = SiteCatalog;
})(typeof window !== 'undefined' ? window : this);
