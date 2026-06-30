/**
 * Éditeur tableaux (œuvres) — API locale (dev) ou Edge Function Supabase (en ligne).
 */
(function () {
  const AUTH = () => window.EditorCommon;
  const MEDIA_BASE = 'media/';
  const DEFAULT_PAGE_SIZE = 50;
  const PRODUCTION_API =
    'https://leezsypadtvypdgqgvtk.supabase.co/functions/v1/works-api';
  const PRODUCTION_CODES_API =
    'https://leezsypadtvypdgqgvtk.supabase.co/functions/v1/codes-api';
  const PRODUCTION_COLLECTORS_API =
    'https://leezsypadtvypdgqgvtk.supabase.co/functions/v1/collectors-api';
  const PRODUCTION_SERIES_API =
    'https://leezsypadtvypdgqgvtk.supabase.co/functions/v1/series-api';
  const NEW_OPTION_VALUE = '__new__';
  /** Écart relatif H/L (hauteur ÷ largeur) : vert < 5 %, jaune foncé 5–10 %, rouge > 10 %. */
  const FORMAT_RATIO_OK = 0.05;
  const FORMAT_RATIO_WARN = 0.10;
  const RASTER_EXT = new Set([
    '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.avif',
  ]);

  let siteConfig = null;
  let resolvedApiBase = '';
  /** @type {Map<string, string> | null} */
  let workMediaById = null;
  /** @type {Map<string, { w: number, h: number } | null> | null} */
  let workImageDimensionsById = null;
  /** @type {Array<object>} */
  let worksList = [];
  /** @type {object} */
  let meta = {
    formats: [],
    techniques: [],
    series: [],
    collectors: [],
    publication_statuses: [],
    photo_statuses: [],
  };
  const dirtyIds = new Set();
  let token = '';
  let filterText = '';
  let seriesFilterText = '';
  let sortColumn = 'order';
  let currentPage = 0;
  let deleteUnlocked = false;

  const loginEl = document.getElementById('works-login');
  const appEl = document.getElementById('works-app');
  const passEl = document.getElementById('works-pass');
  const loginBtn = document.getElementById('works-login-btn');
  const loginErr = document.getElementById('works-login-error');
  const apiHint = document.getElementById('works-api-hint');
  const tbody = document.getElementById('works-tbody');
  const countEl = document.getElementById('works-count');
  const statusEl = document.getElementById('works-status');
  const saveBtn = document.getElementById('works-save-btn');
  const reloadBtn = document.getElementById('works-reload-btn');
  const deleteLockBtn = document.getElementById('works-delete-lock-btn');
  const deleteLockIcon = document.getElementById('works-delete-lock-icon');
  const filterEl = document.getElementById('works-filter-title');
  const seriesFilterEl = document.getElementById('works-filter-series');
  const paginationEl = document.getElementById('works-pagination');
  const pagePrevBtn = document.getElementById('works-page-prev');
  const pageNextBtn = document.getElementById('works-page-next');
  const pageInfoEl = document.getElementById('works-page-info');
  const pageSizeEl = document.getElementById('works-page-size');
  const previewImg = document.getElementById('works-preview-img');
  /** @type {HTMLElement | null} */
  let openSeriesPanel = null;
  /** @type {ResizeObserver | null} */
  let stickyBarObserver = null;
  /** @type {ResizeObserver | null} */
  let stickyTabsObserver = null;

  function updateWorksStickyOffset() {
    const tabs = document.querySelector('.editor-tabs-nav');
    const bar = document.getElementById('works-sticky-bar');
    const root = document.documentElement;
    const tabsH = tabs ? Math.ceil(tabs.getBoundingClientRect().height) : 0;
    const barH = bar ? Math.ceil(bar.offsetHeight) : 0;
    root.style.setProperty('--editor-tabs-sticky-offset', `${tabsH}px`);
    root.style.setProperty('--works-sticky-offset', `${tabsH + barH}px`);
  }

  function bindStickyHeaderOffset() {
    const bar = document.getElementById('works-sticky-bar');
    const tabs = document.querySelector('.editor-tabs-nav');
    if (!bar || stickyBarObserver) return;
    updateWorksStickyOffset();
    window.addEventListener('resize', updateWorksStickyOffset);
    if (typeof ResizeObserver !== 'undefined') {
      stickyBarObserver = new ResizeObserver(updateWorksStickyOffset);
      stickyBarObserver.observe(bar);
      if (tabs) {
        stickyTabsObserver = new ResizeObserver(updateWorksStickyOffset);
        stickyTabsObserver.observe(tabs);
      }
    }
  }

  async function loadSiteConfig() {
    if (siteConfig) return siteConfig;
    siteConfig = {};
    try {
      const r = await fetch(MEDIA_BASE + 'collectors-config.json', { cache: 'no-store' });
      if (r.ok) siteConfig = await r.json();
    } catch {
      /* optionnel */
    }
    return siteConfig;
  }

  function isLocalDevServer() {
    return window.location.port === '47835';
  }

  function isProductionHost() {
    const h = window.location.hostname || '';
    return (
      h === 'mariesallantin.art' ||
      h === 'www.mariesallantin.art' ||
      h.endsWith('.github.io')
    );
  }

  async function apiBase() {
    if (resolvedApiBase) return resolvedApiBase;
    if (isLocalDevServer()) {
      resolvedApiBase = window.location.origin;
      return resolvedApiBase;
    }
    const metaTag = document.querySelector('meta[name="works-api"]');
    const metaUrl = metaTag && metaTag.getAttribute('content');
    if (metaUrl && !metaUrl.includes('127.0.0.1')) {
      resolvedApiBase = String(metaUrl).trim().replace(/\/$/, '');
      return resolvedApiBase;
    }
    const cfg = await loadSiteConfig();
    if (cfg.worksApiUrl) {
      resolvedApiBase = String(cfg.worksApiUrl).trim().replace(/\/$/, '');
      return resolvedApiBase;
    }
    if (isProductionHost()) {
      resolvedApiBase = PRODUCTION_API;
      return resolvedApiBase;
    }
    resolvedApiBase = 'http://127.0.0.1:47835';
    return resolvedApiBase;
  }

  function isOnlineApi(base) {
    return base.includes('supabase.co');
  }

  async function supabaseAnonKey() {
    const metaTag = document.querySelector('meta[name="supabase-anon-key"]');
    const fromMeta = metaTag ? String(metaTag.getAttribute('content') || '').trim() : '';
    if (fromMeta) return fromMeta;
    const cfg = await loadSiteConfig();
    return cfg.anonKey ? String(cfg.anonKey).trim() : '';
  }

  async function apiFetch(pathAndQuery, init) {
    const base = await apiBase();
    return serviceApiFetch(base, pathAndQuery, init);
  }

  async function serviceApiFetch(base, pathAndQuery, init) {
    const headers = new Headers((init && init.headers) || {});
    if (init && init.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    if (isOnlineApi(base)) {
      const anon = await supabaseAnonKey();
      if (!anon) throw new Error('Clé anon manquante (collectors-config.json ou meta)');
      headers.set('apikey', anon);
      headers.set('Authorization', 'Bearer ' + anon);
    }
    return fetch(String(base).replace(/\/$/, '') + pathAndQuery, { ...init, headers });
  }

  async function codesApiBase() {
    const cfg = await loadSiteConfig();
    return String(cfg.codesApiUrl || PRODUCTION_CODES_API).trim().replace(/\/$/, '');
  }

  async function collectorsApiBase() {
    const cfg = await loadSiteConfig();
    return String(cfg.collectorsApiUrl || PRODUCTION_COLLECTORS_API).trim().replace(/\/$/, '');
  }

  async function seriesApiBase() {
    const cfg = await loadSiteConfig();
    return String(cfg.seriesApiUrl || PRODUCTION_SERIES_API).trim().replace(/\/$/, '');
  }

  function syncMetaFormats(formats) {
    meta.formats = (formats || []).map((f) => ({
      code: f.code,
      label: f.label || '',
      width_cm: f.width_cm ?? null,
      height_cm: f.height_cm ?? null,
    }));
  }

  function syncMetaTechniques(techniques) {
    meta.techniques = (techniques || []).map((t) => ({
      code: t.code,
      label: t.label || '',
    }));
  }

  function syncMetaSeries(series) {
    meta.series = (series || []).map((s) => ({
      code: s.code,
      label: s.label || '',
    }));
  }

  function syncMetaCollectors(collectors) {
    meta.collectors = (collectors || []).map((c) => ({
      code: c.code,
      label: c.name || c.label || c.code,
    }));
  }

  function webThumbRelFromMediaFp(mediaFp) {
    const fp = String(mediaFp || '').trim().replace(/\\/g, '/');
    if (!fp.toLowerCase().startsWith('catalogue/')) return null;
    const rest = fp.slice('catalogue/'.length);
    const lastSlash = rest.lastIndexOf('/');
    const filePart = lastSlash >= 0 ? rest.slice(lastSlash + 1) : rest;
    const i = filePart.lastIndexOf('.');
    const ext = i >= 0 ? filePart.slice(i).toLowerCase() : '';
    if (!RASTER_EXT.has(ext)) return null;
    const stem = filePart.replace(/\.[^.]+$/i, '');
    const dirPart = lastSlash >= 0 ? rest.slice(0, lastSlash) : '';
    return dirPart
      ? 'catalogue/_thumbs/' + dirPart + '/' + stem + '.webp'
      : 'catalogue/_thumbs/' + stem + '.webp';
  }

  function encodeMediaPath(url) {
    return String(url)
      .split('/')
      .map((seg, idx) =>
        idx === 0 ? seg : encodeURIComponent(String(seg).normalize('NFC'))
      )
      .join('/');
  }

  function thumbUrlForMedia(media) {
    const thumbRel = webThumbRelFromMediaFp(media);
    return thumbRel
      ? MEDIA_BASE + encodeMediaPath(thumbRel)
      : MEDIA_BASE + encodeMediaPath(media);
  }

  function mediaPathForWork(work) {
    if (!work || !work.id) return '';
    const workId = String(work.id).trim().toUpperCase();
    if (workMediaById && workMediaById.has(workId)) {
      return workMediaById.get(workId);
    }
    const orig = String(work.filename_original || '').trim().replace(/\\/g, '/');
    if (orig && orig.toUpperCase().startsWith(workId)) {
      return 'catalogue/' + orig;
    }
    const ext = String(work.image_ext || 'jpeg').replace(/^\./, '');
    return 'catalogue/' + workId + '.' + ext;
  }

  function thumbUrlForWork(work) {
    const media = mediaPathForWork(work);
    return media ? thumbUrlForMedia(media) : '';
  }

  function originalFilenameLabel(work) {
    if (!work) return '';
    const fn = String(work.filename_original || '').trim();
    if (fn) return fn;
    const media = mediaPathForWork(work);
    if (!media) return '';
    const base = media.split('/').pop() || '';
    if (!base || /^MS\d{4}\.\w+$/i.test(base)) return '';
    return base;
  }

  async function loadWorksCatalog() {
    if (workMediaById) return;
    workMediaById = new Map();
    workImageDimensionsById = new Map();
    try {
      const r = await fetch(MEDIA_BASE + 'works.json', { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        for (const w of j.works || []) {
          const id = String(w.id || '').trim().toUpperCase();
          if (id && w.media) workMediaById.set(id, String(w.media).trim());
          const dim = parseDimensionsPx(w.dimensions);
          if (id && dim) workImageDimensionsById.set(id, dim);
        }
      }
    } catch {
      /* optionnel */
    }
  }

  async function reloadWorksCatalog() {
    workMediaById = null;
    workImageDimensionsById = null;
    await loadWorksCatalog();
  }

  function mergeImportMediaPaths(importedRows) {
    if (!importedRows || !importedRows.length) return;
    if (!workMediaById) workMediaById = new Map();
    for (const row of importedRows) {
      if (row.status !== 'ok' || !row.workId || !row.media) continue;
      const id = String(row.workId).trim().toUpperCase();
      workMediaById.set(id, String(row.media).trim());
    }
  }

  function parseDimensionsPx(str) {
    const s = String(str || '').trim();
    const m = s.match(/(\d+)\s*[×x]\s*(\d+)/i);
    if (!m) return null;
    const w = parseInt(m[1], 10);
    const h = parseInt(m[2], 10);
    if (w > 0 && h > 0) return { w, h };
    return null;
  }

  /** @returns {Promise<{ w: number, h: number } | null>} */
  function probeImageNaturalSize(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        if (w > 0 && h > 0) resolve({ w, h });
        else resolve(null);
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  function relativeFormatHeightWidthDelta(imgW, imgH, fmtWcm, fmtHcm) {
    const imgHl = imgH / imgW;
    const fmtHl = fmtHcm / fmtWcm;
    return Math.abs(imgHl - fmtHl) / fmtHl;
  }

  function formatRatioLevel(delta) {
    if (delta < FORMAT_RATIO_OK) return 'ok';
    if (delta <= FORMAT_RATIO_WARN) return 'warn';
    return 'bad';
  }

  function checkFormatImageRatio(formatCode, imgW, imgH) {
    const code = String(formatCode || '').trim().toUpperCase();
    if (!code || !imgW || !imgH) return null;
    const fmt = formatByCode(code);
    if (!fmt || fmt.width_cm == null || fmt.height_cm == null) return null;
    const fmtW = Number(fmt.width_cm);
    const fmtH = Number(fmt.height_cm);
    if (!(fmtW > 0 && fmtH > 0)) return null;
    const imgRatio = imgH / imgW;
    const fmtRatio = fmtH / fmtW;
    const delta = relativeFormatHeightWidthDelta(imgW, imgH, fmtW, fmtH);
    return {
      level: formatRatioLevel(delta),
      delta,
      fmtW,
      fmtH,
      imgW,
      imgH,
      imgRatio,
      fmtRatio,
      formatCode: code,
    };
  }

  function formatRatioTooltip(result) {
    if (!result) return '';
    const pct = Math.round(result.delta * 100);
    const imgHl = result.imgRatio.toFixed(3);
    const fmtHl = result.fmtRatio.toFixed(3);
    const status =
      result.level === 'ok'
        ? 'cohérent'
        : result.level === 'warn'
          ? 'écart modéré'
          : 'incohérent';
    return (
      result.formatCode +
      ' : H/L format ' +
      fmtHl +
      ' (' +
      result.fmtH +
      '×' +
      result.fmtW +
      ' cm) · image ' +
      imgHl +
      ' (' +
      result.imgH +
      '×' +
      result.imgW +
      ' px) · ' +
      status +
      ' (écart ' +
      pct +
      ' %)'
    );
  }

  function formatRatioImportMessage(result) {
    if (!result || result.level === 'ok') return '';
    return formatRatioTooltip(result);
  }

  function applyFormatRatioUi(work, select, dot) {
    if (!dot || !work) return;
    dot.hidden = true;
    dot.className = 'works-format-ratio-dot';
    dot.removeAttribute('title');
    if (select) select.removeAttribute('title');
    if (!work.format_code) return;
    const dims = workImageDimensionsById && workImageDimensionsById.get(work.id);
    if (!dims || !dims.w || !dims.h) {
      dot.className = 'works-format-ratio-dot works-format-ratio-dot--pending';
      dot.hidden = false;
      dot.title = 'Lecture des dimensions image…';
      return;
    }
    const result = checkFormatImageRatio(work.format_code, dims.w, dims.h);
    if (!result) return;
    dot.hidden = false;
    dot.className = 'works-format-ratio-dot works-format-ratio-dot--' + result.level;
    const tip = formatRatioTooltip(result);
    dot.title = tip;
    if (select) select.title = tip;
  }

  async function probeWorkImageDimensions(work) {
    if (!workImageDimensionsById) workImageDimensionsById = new Map();
    if (workImageDimensionsById.has(work.id)) return;
    const url = thumbUrlForWork(work);
    if (!url) {
      workImageDimensionsById.set(work.id, null);
      return;
    }
    const dim = await probeImageNaturalSize(url);
    workImageDimensionsById.set(work.id, dim);
  }

  function updateFormatMismatchInDom(workId) {
    if (!tbody) return;
    const tr = tbody.querySelector('tr[data-work-id="' + workId + '"]');
    if (!tr) return;
    const work = worksList.find((w) => w.id === workId);
    if (!work) return;
    const td = tr.querySelector('.works-format-cell');
    const select = td && td.querySelector('select');
    const dot = td && td.querySelector('.works-format-ratio-dot');
    if (select && dot) applyFormatRatioUi(work, select, dot);
  }

  function scheduleFormatRatioProbes(pageItems) {
    if (!workImageDimensionsById) workImageDimensionsById = new Map();
    for (const work of pageItems) {
      if (!work.format_code) continue;
      if (workImageDimensionsById.has(work.id)) {
        updateFormatMismatchInDom(work.id);
        continue;
      }
      probeWorkImageDimensions(work).then(() => updateFormatMismatchInDom(work.id));
    }
  }

  async function probeImportFormatRatios(plan) {
    if (!importPreviewTbody) return;
    const rows = importPreviewTbody.querySelectorAll('tr[data-import-format]');
    for (const tr of rows) {
      const formatCode = tr.dataset.importFormat;
      const previewUrl = tr.dataset.importPreviewUrl;
      if (!formatCode || !previewUrl) continue;
      const dim = await probeImageNaturalSize(previewUrl);
      if (!dim) continue;
      const check = checkFormatImageRatio(formatCode, dim.w, dim.h);
      if (!check || check.level === 'ok') continue;
      const tdErr = tr.querySelector('.works-import-format-ratio-cell');
      const tdMeta = tr.querySelector('.works-import-meta-cell');
      const msg = formatRatioImportMessage(check);
      if (tdErr && msg && !tdErr.textContent.includes('H/L format')) {
        tdErr.textContent = tdErr.textContent ? tdErr.textContent + ' · ' + msg : msg;
        tdErr.classList.add('works-import-format-ratio--' + check.level);
      }
      if (tdMeta && check.level === 'bad') {
        tdMeta.classList.add('works-import-meta-cell--format-mismatch');
      }
    }
  }

  function updateDeleteLockUi() {
    if (deleteLockBtn) {
      deleteLockBtn.setAttribute('aria-pressed', deleteUnlocked ? 'true' : 'false');
      deleteLockBtn.title = deleteUnlocked
        ? 'Suppression activée — cliquer pour verrouiller'
        : 'Suppression verrouillée — cliquer pour afficher les corbeilles';
      deleteLockBtn.setAttribute(
        'aria-label',
        deleteUnlocked ? 'Verrouiller la suppression' : 'Déverrouiller la suppression'
      );
    }
    if (deleteLockIcon) {
      deleteLockIcon.src = deleteUnlocked
        ? 'images/cadenas_open.png'
        : 'images/cadenas_close.png';
    }
    if (appEl) {
      appEl.classList.toggle('works-delete-unlocked', deleteUnlocked);
    }
  }

  function createDeleteWorkButton(work, tr) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'works-delete-btn';
    btn.setAttribute('aria-label', 'Supprimer ' + (work.id || ''));
    btn.title = 'Supprimer l\'enregistrement ' + (work.id || '');
    btn.innerHTML =
      '<svg class="works-delete-btn-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
      '<path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>' +
      '</svg>';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!deleteUnlocked) return;
      deleteWork(work).catch((err) => setStatus(String(err.message || err), true));
    });
    return btn;
  }

  async function deleteWork(work) {
    if (!work || !work.id || !deleteUnlocked) return;
    const label = work.id + (work.title ? ' — ' + work.title : '');
    const msg =
      'Supprimer l\'œuvre ' +
      label +
      ' de la base ?\n\nLes fichiers image (catalogue) ne sont pas effacés du disque.';
    if (!window.confirm(msg)) return;

    setStatus('Suppression…');
    try {
      const r = await apiFetch('/api/works/delete', {
        method: 'POST',
        body: JSON.stringify({ token, work_id: work.id }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        if (r.status === 404) {
          throw new Error(
            'Suppression indisponible : redémarrez npm run works:api (local) ou déployez works-api (en ligne).'
          );
        }
        throw new Error(formatApiError(j.error) || 'suppression échouée');
      }
      const deletedId = String(j.deleted || work.id)
        .trim()
        .toUpperCase();
      worksList = Array.isArray(j.works)
        ? j.works.filter((w) => String(w.id).trim().toUpperCase() !== deletedId)
        : worksList.filter((w) => String(w.id).trim().toUpperCase() !== deletedId);
      dirtyIds.delete(work.id);
      if (workMediaById) workMediaById.delete(work.id);
      if (workImageDimensionsById) workImageDimensionsById.delete(work.id);
      updateSaveBtn();
      renderTable();
      let statusMsg = 'Œuvre ' + work.id + ' supprimée.';
      if (isLocalDevServer() && j.works_json_removed) {
        statusMsg += ' Entrée retirée de works.json.';
      }
      setStatus(statusMsg);
    } catch (e) {
      setStatus(String(e.message || e), true);
    }
  }

  function setStatus(msg, isError) {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.style.color = isError ? '#b00020' : '';
  }

  function updateSaveBtn() {
    EditorCommon.updateSaveButton(saveBtn, dirtyIds.size > 0);
  }

  function markDirty(id, tr) {
    dirtyIds.add(id);
    if (tr) tr.classList.add('legend-editor-row--dirty');
    updateSaveBtn();
  }

  function msIdSortKey(id) {
    const m = String(id || '').match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  }

  function collectorByCode(code) {
    if (!code) return null;
    return (meta.collectors || []).find((c) => c.code === code) || null;
  }

  function collectorSortLabel(code) {
    const c = collectorByCode(code);
    return (c && c.name) || String(code || '').trim();
  }

  function getWorkSortValue(work, col) {
    switch (col) {
      case 'id':
        return msIdSortKey(work.id);
      case 'title':
        return String(work.title || '').trim().toLocaleLowerCase('fr');
      case 'year':
        return work.year != null && work.year !== '' ? Number(work.year) : null;
      case 'format':
        return String(work.format_code || '').trim().toUpperCase();
      case 'series':
        return formatSeriesFullTitle(work.series_codes).toLocaleLowerCase('fr');
      case 'technique':
        return String(work.technique_code || '').trim().toUpperCase();
      case 'collector':
        return collectorSortLabel(work.collector_code).toLocaleLowerCase('fr');
      case 'publication':
        return String(work.publication_status_code || 'N').trim().toUpperCase();
      case 'photo':
        return String(work.photo_status_code || '').trim().toUpperCase();
      case 'order':
      default:
        return Number.isFinite(Number(work.sort_order)) ? Number(work.sort_order) : msIdSortKey(work.id);
    }
  }

  function compareWorks(a, b) {
    const va = getWorkSortValue(a, sortColumn);
    const vb = getWorkSortValue(b, sortColumn);

    if (sortColumn === 'year') {
      const aNull = va == null || Number.isNaN(va);
      const bNull = vb == null || Number.isNaN(vb);
      if (aNull && bNull) return msIdSortKey(a.id) - msIdSortKey(b.id);
      if (aNull) return 1;
      if (bNull) return -1;
      const diff = va - vb;
      if (diff !== 0) return diff;
      return msIdSortKey(a.id) - msIdSortKey(b.id);
    }

    if (typeof va === 'number' && typeof vb === 'number') {
      const diff = va - vb;
      if (diff !== 0) return diff;
      return msIdSortKey(a.id) - msIdSortKey(b.id);
    }

    const sa = String(va ?? '');
    const sb = String(vb ?? '');
    const emptyRank = (s) => (s ? 0 : 1);
    const rankDiff = emptyRank(sa) - emptyRank(sb);
    if (rankDiff !== 0) return rankDiff;
    const diff = sa.localeCompare(sb, 'fr', { numeric: true, sensitivity: 'base' });
    if (diff !== 0) return diff;
    return msIdSortKey(a.id) - msIdSortKey(b.id);
  }

  function sortWorks(list) {
    return [...list].sort(compareWorks);
  }

  function stripAccents(s) {
    return String(s)
      .normalize('NFD')
      .replace(/\p{M}/gu, '');
  }

  /** Recherche titre : insensible à la casse, aux accents et à la forme Unicode (NFC/NFD). */
  function normalizeForSearch(s) {
    return stripAccents(String(s || '')).toLowerCase();
  }

  function parseSeriesFilterTokens(raw) {
    return String(raw || '')
      .trim()
      .toUpperCase()
      .split(/[\s,;]+/)
      .map((t) => t.replace(/[^A-Z0-9]/g, ''))
      .filter(Boolean);
  }

  function workMatchesSeriesFilter(work, tokens) {
    if (!tokens.length) return true;
    const codes = new Set((work.series_codes || []).map((c) => String(c).trim().toUpperCase()));
    return tokens.every((t) => codes.has(t));
  }

  function filterWorks(list) {
    let result = list;
    const q = normalizeForSearch(filterText);
    if (q) {
      result = result.filter((w) => normalizeForSearch(w.title).includes(q));
    }
    const seriesTokens = parseSeriesFilterTokens(seriesFilterText);
    if (seriesTokens.length) {
      result = result.filter((w) => workMatchesSeriesFilter(w, seriesTokens));
    }
    return result;
  }

  function displayedWorks() {
    return sortWorks(filterWorks(worksList));
  }

  function updateSortButtonsUI() {
    document.querySelectorAll('.works-sort-btn').forEach((btn) => {
      const key = btn.getAttribute('data-sort-key');
      const active = key === sortColumn;
      btn.classList.toggle('catalogue-sort-btn--active', active);
      const up = btn.querySelector('.catalogue-sort-up');
      if (up) up.classList.toggle('is-active', active);
      const th = btn.closest('th');
      if (th) {
        if (active) th.setAttribute('aria-sort', 'ascending');
        else th.removeAttribute('aria-sort');
      }
    });
  }

  function hasActiveFilters() {
    return Boolean(filterText.trim() || seriesFilterText.trim());
  }

  function sortByCode(list) {
    return [...(list || [])].sort((a, b) =>
      String(a.code || '').localeCompare(String(b.code || ''), 'fr')
    );
  }

  function sortFormatsList(list) {
    const ec = AUTH();
    return ec && ec.sortFormats ? ec.sortFormats(list) : sortByCode(list);
  }

  function sortMetaLists() {
    meta.formats = sortFormatsList(meta.formats);
    meta.techniques = sortByCode(meta.techniques);
    meta.series = sortByCode(meta.series);
    meta.publication_statuses = sortByCode(meta.publication_statuses);
    meta.photo_statuses = sortByCode(meta.photo_statuses);
    meta.collectors = [...(meta.collectors || [])].sort((a, b) =>
      String(a.label || a.code || '').localeCompare(String(b.label || b.code || ''), 'fr')
    );
  }

  function formatSeriesDisplay(codes) {
    const sorted = sortByCode((codes || []).map((c) => ({ code: c }))).map((x) => x.code);
    if (!sorted.length) return '—';
    if (sorted.length <= 3) return sorted.join(', ');
    return sorted.slice(0, 2).join(', ') + ', ...';
  }

  function formatSeriesFullTitle(codes) {
    const sorted = sortByCode((codes || []).map((c) => ({ code: c }))).map((x) => x.code);
    return sorted.length ? sorted.join(', ') : 'Aucune série';
  }

  function closeAllSeriesPanels() {
    document.querySelectorAll('.works-series-panel').forEach((p) => {
      p.hidden = true;
      p.classList.remove('works-series-panel--fixed');
      p.style.top = '';
      p.style.left = '';
      p.style.minWidth = '';
    });
    openSeriesPanel = null;
  }

  function seriesPanelColumnCount() {
    const n = (meta.series || []).length;
    if (n <= 8) return 2;
    if (n <= 16) return 3;
    if (n <= 30) return 4;
    return 5;
  }

  function positionSeriesPanel(toggle, panel) {
    const rect = toggle.getBoundingClientRect();
    const cols = seriesPanelColumnCount();
    panel.classList.add('works-series-panel--fixed');
    panel.dataset.columns = String(cols);
    const minW = Math.max(rect.width, cols * 5.75 * 16);
    panel.style.minWidth = minW + 'px';
    panel.style.left = rect.left + 'px';
    panel.style.top = rect.bottom + 2 + 'px';
    const panelRect = panel.getBoundingClientRect();
    if (panelRect.bottom > window.innerHeight - 8) {
      panel.style.top = Math.max(8, rect.top - panelRect.height - 2) + 'px';
    }
    if (panelRect.right > window.innerWidth - 8) {
      panel.style.left = Math.max(8, window.innerWidth - panelRect.width - 8) + 'px';
    }
  }

  function formatByCode(code) {
    return meta.formats.find((f) => f.code === code) || null;
  }

  function refreshSelectOptionLabels(selectEl, options, labelMode, { onlySelected = false } = {}) {
    Array.from(selectEl.options).forEach((o) => {
      if (!o.value || o.disabled || o.classList.contains('works-select-separator')) return;
      const item = options.find((x) => x.code === o.value);
      if (!item) return;
      if (onlySelected && o !== selectEl.options[selectEl.selectedIndex]) return;
      o.textContent = optionLabel(item, labelMode);
    });
  }

  /** Menu ouvert : libellés complets ; cellule fermée : code seul (select natif). */
  function attachClosedCodeSelectDisplay(selectEl, options, openLabelMode, closedLabelMode) {
    const collapse = () =>
      refreshSelectOptionLabels(selectEl, options, closedLabelMode, { onlySelected: true });
    const expand = () => refreshSelectOptionLabels(selectEl, options, openLabelMode);

    selectEl.addEventListener('mousedown', expand);
    selectEl.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        expand();
      }
    });
    selectEl.addEventListener('change', collapse);
    selectEl.addEventListener('blur', collapse);
    collapse();
  }

  function optionLabel(x, mode) {
    if (mode === 'name') return x.label || x.code;
    if (mode === 'label') return x.label || x.code;
    if (mode === 'code') return x.code;
    return x.label ? `${x.code} — ${x.label}` : x.code;
  }

  function usedTechniqueCodes() {
    const used = new Set();
    for (const w of worksList) {
      if (w.technique_code) used.add(w.technique_code);
    }
    return used;
  }

  function appendSelectSeparator(selectEl, label) {
    const sep = document.createElement('option');
    sep.disabled = true;
    sep.value = '';
    sep.textContent = label ? `— ${label} —` : '────────';
    sep.className = label ? 'works-select-group-label' : 'works-select-separator';
    selectEl.appendChild(sep);
  }

  function appendSelectOption(selectEl, item, labelMode) {
    const o = document.createElement('option');
    o.value = item.code;
    o.textContent = optionLabel(item, labelMode);
    selectEl.appendChild(o);
  }

  /**
   * @param {HTMLSelectElement} selectEl
   * @param {Array<{code:string,label?:string}>} options
   * @param {{ placeholder?: string, allowEmpty?: boolean, allowNew?: boolean, labelMode?: string, currentValue?: string, groupUsedFirst?: boolean, usedCodesSet?: Set<string>, groupFormatsByFamily?: boolean }} cfg
   */
  function fillSelectOptions(selectEl, options, cfg) {
    const {
      placeholder = '—',
      allowEmpty = true,
      allowNew = false,
      labelMode = 'code',
      currentValue = '',
      groupUsedFirst = false,
      usedCodesSet = null,
      groupFormatsByFamily = false,
    } = cfg || {};

    selectEl.innerHTML = '';
    if (allowEmpty) {
      const optEmpty = document.createElement('option');
      optEmpty.value = '';
      optEmpty.textContent = placeholder;
      selectEl.appendChild(optEmpty);
    }

    const appendItems = (items) => {
      items.forEach((x) => appendSelectOption(selectEl, x, labelMode));
    };

    if (groupFormatsByFamily) {
      const ec = AUTH();
      const groups = ec && ec.groupFormatsByFamily ? ec.groupFormatsByFamily(options) : [];
      if (groups.length) {
        groups.forEach((g) => {
          if (g.label) appendSelectSeparator(selectEl, g.label);
          appendItems(g.items);
        });
      } else {
        appendItems(sortFormatsList(options));
      }
    } else {
      const sorted = sortByCode(options);
      if (groupUsedFirst && usedCodesSet) {
        const used = sorted.filter((x) => usedCodesSet.has(x.code));
        const other = sorted.filter((x) => !usedCodesSet.has(x.code));
        used.forEach((x) => appendSelectOption(selectEl, x, labelMode));
        if (used.length && other.length) appendSelectSeparator(selectEl);
        other.forEach((x) => appendSelectOption(selectEl, x, labelMode));
        if (allowNew && (used.length || other.length)) appendSelectSeparator(selectEl);
      } else {
        sorted.forEach((x) => appendSelectOption(selectEl, x, labelMode));
        if (allowNew && sorted.length) appendSelectSeparator(selectEl);
      }
    }

    if (allowNew && (!groupFormatsByFamily || options.length)) {
      if (groupFormatsByFamily && options.length) appendSelectSeparator(selectEl);
      const optNew = document.createElement('option');
      optNew.value = NEW_OPTION_VALUE;
      optNew.textContent = '— Nouveau —';
      optNew.className = 'works-select-new-option';
      selectEl.appendChild(optNew);
    }
    if (currentValue && currentValue !== NEW_OPTION_VALUE) {
      selectEl.value = currentValue;
    }
  }

  function updateSeriesToggle(toggle, work) {
    toggle.textContent = formatSeriesDisplay(work.series_codes);
    toggle.title = formatSeriesFullTitle(work.series_codes);
  }

  function createSeriesPickerCell(work, tr) {
    const td = document.createElement('td');
    td.className = 'works-select-cell works-series-picker-cell';

    const wrap = document.createElement('div');
    wrap.className = 'works-series-picker';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'works-series-toggle';
    updateSeriesToggle(toggle, work);

    const panel = document.createElement('div');
    panel.className = 'works-series-panel catalogue-multiselect-panel';
    panel.hidden = true;

    const grid = document.createElement('div');
    grid.className = 'works-series-panel-grid';
    grid.style.setProperty('--works-series-cols', String(seriesPanelColumnCount()));

    const selected = new Set(work.series_codes || []);

    sortByCode(meta.series).forEach((x) => {
      const label = document.createElement('label');
      label.className = 'works-series-option catalogue-series-option';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = x.code;
      cb.checked = selected.has(x.code);
      cb.addEventListener('change', () => {
        if (!work.series_codes) work.series_codes = [];
        if (cb.checked) {
          if (!work.series_codes.includes(x.code)) work.series_codes.push(x.code);
        } else {
          work.series_codes = work.series_codes.filter((c) => c !== x.code);
        }
        updateSeriesToggle(toggle, work);
        markDirty(work.id, tr);
      });
      label.appendChild(cb);
      label.appendChild(document.createTextNode(x.code));
      grid.appendChild(label);
    });

    panel.appendChild(grid);

    const newBtn = document.createElement('button');
    newBtn.type = 'button';
    newBtn.className = 'works-series-new-btn';
    newBtn.textContent = '— Nouveau —';
    newBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        const code = await createSeriesFromPrompt();
        if (code) {
          if (!work.series_codes) work.series_codes = [];
          if (!work.series_codes.includes(code)) work.series_codes.push(code);
          markDirty(work.id, tr);
          renderTable();
          setStatus('Série ' + code + ' créée.');
        }
      } catch (err) {
        setStatus(String(err.message || err), true);
      }
    });
    panel.appendChild(newBtn);

    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = panel.hidden;
      closeAllSeriesPanels();
      if (willOpen) {
        panel.hidden = false;
        openSeriesPanel = panel;
        positionSeriesPanel(toggle, panel);
      }
    });

    panel.addEventListener('click', (e) => e.stopPropagation());

    wrap.appendChild(toggle);
    wrap.appendChild(panel);
    td.appendChild(wrap);
    return td;
  }

  async function createFormatFromPrompt() {
    const code = window.prompt('Code du nouveau format (4 caractères, ex. HF10) :');
    if (!code) return null;
    const normalized = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(normalized)) {
      throw new Error('Code invalide : 4 caractères A-Z ou chiffres.');
    }
    const base = await codesApiBase();
    const r = await serviceApiFetch(base, '/api/formats/create', {
      method: 'POST',
      body: JSON.stringify({ token, code: normalized }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'échec création format');
    syncMetaFormats(j.formats);
    if (j.techniques) syncMetaTechniques(j.techniques);
    sortMetaLists();
    return j.createdCode || normalized;
  }

  async function createTechniqueFromPrompt() {
    const code = window.prompt('Code de la nouvelle technique (3 caractères, ex. GOU) :');
    if (!code) return null;
    const normalized = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{3}$/.test(normalized)) {
      throw new Error('Code invalide : 3 caractères A-Z ou chiffres.');
    }
    const base = await codesApiBase();
    const r = await serviceApiFetch(base, '/api/techniques/create', {
      method: 'POST',
      body: JSON.stringify({ token, code: normalized }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'échec création technique');
    if (j.formats) syncMetaFormats(j.formats);
    syncMetaTechniques(j.techniques);
    sortMetaLists();
    return j.createdCode || normalized;
  }

  async function createCollectorFromPrompt() {
    const name = window.prompt('Nom du nouveau collectionneur :');
    if (!name || !name.trim()) return null;
    const base = await collectorsApiBase();
    const r = await serviceApiFetch(base, '/api/collectors/create', {
      method: 'POST',
      body: JSON.stringify({
        token,
        collector: {
          name: name.trim(),
          collector_type: 'Particulier',
          first_name: '',
          phone: '',
          email: '',
          notes: '',
        },
      }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'échec création collectionneur');
    syncMetaCollectors(j.collectors);
    sortMetaLists();
    return j.collector && j.collector.code ? j.collector.code : null;
  }

  async function createSeriesFromPrompt() {
    const code = window.prompt('Code de la nouvelle série (2–12 caractères, ex. ABSTR) :');
    if (!code) return null;
    const normalized = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{2,12}$/.test(normalized)) {
      throw new Error('Code invalide : 2–12 caractères A-Z ou chiffres.');
    }
    const label = window.prompt('Libellé de la série (optionnel) :') || '';
    const base = await seriesApiBase();
    const r = await serviceApiFetch(base, '/api/series/create', {
      method: 'POST',
      body: JSON.stringify({ token, code: normalized, label: label.trim() }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'échec création série');
    syncMetaSeries(j.series);
    sortMetaLists();
    return normalized;
  }

  async function handleSelectNew(selectEl, kind) {
    if (!selectEl || selectEl.value !== NEW_OPTION_VALUE) return false;
    const previous = selectEl.dataset.prevValue || '';
    selectEl.value = previous;
    let created = null;
    try {
      if (kind === 'format') created = await createFormatFromPrompt();
      else if (kind === 'technique') created = await createTechniqueFromPrompt();
      else if (kind === 'collector') created = await createCollectorFromPrompt();
      else return false;
    } catch (e) {
      setStatus(String(e.message || e), true);
      return true;
    }
    if (!created) return true;
    return created;
  }

  function applyFormatDimensionsToWork(work, formatCode) {
    const fmt = formatByCode(formatCode);
    if (!fmt || !work) return;
    if (fmt.width_cm != null) work.width_cm = fmt.width_cm;
    if (fmt.height_cm != null) work.height_cm = fmt.height_cm;
  }

  function createTitleCell(work, tr) {
    const td = document.createElement('td');
    td.className = 'works-title-cell';
    const wrap = document.createElement('div');
    wrap.className = 'works-title-cell-inner';
    wrap.appendChild(createDeleteWorkButton(work, tr));
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'legend-input works-title-input';
    input.value = work.title || '';
    input.placeholder = '—';
    input.setAttribute('aria-label', 'Titre de ' + (work.id || ''));
    input.addEventListener('input', () => {
      work.title = input.value;
      markDirty(work.id, tr);
    });
    wrap.appendChild(input);
    td.appendChild(wrap);
    return td;
  }

  function createYearCell(work, tr) {
    const td = document.createElement('td');
    td.className = 'works-year-cell';
    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'numeric';
    input.maxLength = 4;
    input.className = 'legend-input works-year-input';
    input.value = work.year != null && work.year !== '' ? String(work.year) : '';
    input.placeholder = '—';
    input.setAttribute('aria-label', 'Année de ' + (work.id || ''));
    input.addEventListener('input', () => {
      const t = input.value.trim();
      if (!t) {
        work.year = null;
        markDirty(work.id, tr);
        return;
      }
      if (/^\d{4}$/.test(t)) {
        work.year = parseInt(t, 10);
        markDirty(work.id, tr);
      }
    });
    input.addEventListener('blur', () => {
      const t = input.value.trim();
      if (!t) {
        work.year = null;
        input.value = '';
        markDirty(work.id, tr);
        return;
      }
      if (!/^\d{4}$/.test(t)) {
        input.value = work.year != null ? String(work.year) : '';
        setStatus('Année invalide : 4 chiffres attendus.', true);
        return;
      }
      work.year = parseInt(t, 10);
      input.value = t;
      markDirty(work.id, tr);
    });
    td.appendChild(input);
    return td;
  }

  function createCodeSelectCell(work, tr, field, kind, options, cfg) {
    const td = document.createElement('td');
    td.className = 'works-select-cell' + (kind === 'format' ? ' works-format-cell' : '');
    const select = document.createElement('select');
    select.className = 'legend-select works-row-select' + (cfg.extraClass ? ' ' + cfg.extraClass : '');

    fillSelectOptions(select, options, {
      placeholder: cfg.placeholder,
      allowEmpty: cfg.allowEmpty !== false,
      allowNew: cfg.allowNew !== false,
      labelMode: cfg.labelMode || 'code-label',
      currentValue: work[field] || cfg.defaultValue || '',
      groupUsedFirst: kind === 'technique',
      groupFormatsByFamily: kind === 'format',
      usedCodesSet:
        kind === 'technique'
          ? usedTechniqueCodes()
          : null,
    });

    if (cfg.closedLabelMode) {
      attachClosedCodeSelectDisplay(
        select,
        options,
        cfg.labelMode || 'code-label',
        cfg.closedLabelMode
      );
    }

    select.addEventListener('focus', () => {
      select.dataset.prevValue = select.value;
    });

    select.addEventListener('change', async () => {
      if (cfg.allowNew !== false && select.value === NEW_OPTION_VALUE) {
        const created = await handleSelectNew(select, kind);
        if (created === true) return;
        if (created) {
          work[field] = created;
          if (kind === 'format') applyFormatDimensionsToWork(work, created);
          markDirty(work.id, tr);
          renderTable();
          setStatus(
            (kind === 'format' ? 'Format' : kind === 'technique' ? 'Technique' : 'Collectionneur') +
              ' ' + created + ' créé.'
          );
        }
        return;
      }

      const v = String(select.value || '').trim().toUpperCase();
      work[field] = v && v !== NEW_OPTION_VALUE ? v : null;
      if (kind === 'format') {
        applyFormatDimensionsToWork(work, work[field]);
        const dot = td.querySelector('.works-format-ratio-dot');
        applyFormatRatioUi(work, select, dot);
      }
      markDirty(work.id, tr);
    });

    if (kind === 'format') {
      const wrap = document.createElement('div');
      wrap.className = 'works-format-cell-inner';
      const dot = document.createElement('span');
      dot.className = 'works-format-ratio-dot';
      dot.hidden = true;
      dot.setAttribute('aria-hidden', 'true');
      wrap.appendChild(select);
      wrap.appendChild(dot);
      td.appendChild(wrap);
      applyFormatRatioUi(work, select, dot);
    } else {
      td.appendChild(select);
    }
    return td;
  }

  function fullImageUrlForWork(work) {
    const media = mediaPathForWork(work);
    return media ? MEDIA_BASE + encodeMediaPath(media) : '';
  }

  function attachThumbPreview(thumb, fullSrc) {
    if (!thumb || !fullSrc) return;
    thumb.style.cursor = 'zoom-in';

    thumb.addEventListener('mouseenter', (e) => {
      if (!previewImg) return;
      previewImg.src = fullSrc;
      previewImg.classList.add('is-visible');
      positionThumbPreview(e);
    });
    thumb.addEventListener('mousemove', positionThumbPreview);
    thumb.addEventListener('mouseleave', () => {
      if (!previewImg) return;
      previewImg.classList.remove('is-visible');
      previewImg.removeAttribute('src');
    });

    function positionThumbPreview(e) {
      if (!previewImg || !previewImg.classList.contains('is-visible')) return;
      const pad = 16;
      const w = previewImg.offsetWidth || 400;
      const h = previewImg.offsetHeight || 300;
      let x = e.clientX + pad;
      let y = e.clientY + pad;
      if (x + w > window.innerWidth - pad) x = e.clientX - w - pad;
      if (y + h > window.innerHeight - pad) y = e.clientY - h - pad;
      previewImg.style.left = Math.max(pad, x) + 'px';
      previewImg.style.top = Math.max(pad, y) + 'px';
    }
  }

  function filteredWorks() {
    return displayedWorks();
  }

  function getPageSize() {
    if (!pageSizeEl) return DEFAULT_PAGE_SIZE;
    const v = String(pageSizeEl.value || String(DEFAULT_PAGE_SIZE));
    if (v === 'all') return Infinity;
    const n = parseInt(v, 10);
    return Number.isNaN(n) || n < 1 ? DEFAULT_PAGE_SIZE : n;
  }

  function pageCount(list) {
    const pageSize = getPageSize();
    if (!Number.isFinite(pageSize) || pageSize <= 0 || list.length <= pageSize) return 1;
    return Math.max(1, Math.ceil(list.length / pageSize));
  }

  function slicePageItems(list) {
    const pageSize = getPageSize();
    if (!Number.isFinite(pageSize) || pageSize <= 0 || list.length <= pageSize) return list;
    const start = currentPage * pageSize;
    return list.slice(start, start + pageSize);
  }

  function updateCountLabel(list) {
    if (!countEl) return;
    const total = worksList.length;
    const shown = list.length;
    const dirty = dirtyIds.size;
    let text = shown === total
      ? `${total} tableau(x)`
      : `${shown} / ${total} tableau(x)`;
    if (dirty) text += ` · ${dirty} modification(s) non enregistrée(s)`;
    countEl.textContent = text;
  }

  function updatePagination(list) {
    const pageSize = getPageSize();
    const pages = pageCount(list);
    if (currentPage >= pages) currentPage = Math.max(0, pages - 1);
    const paginated =
      Number.isFinite(pageSize) && pageSize > 0 && list.length > pageSize;
    if (paginationEl) paginationEl.hidden = !paginated;
    if (pageInfoEl) {
      pageInfoEl.textContent = paginated
        ? `Page ${currentPage + 1} / ${pages}`
        : '';
    }
    if (pagePrevBtn) pagePrevBtn.disabled = currentPage <= 0;
    if (pageNextBtn) pageNextBtn.disabled = currentPage >= pages - 1;
    updateWorksStickyOffset();
  }

  function renderTable() {
    if (!tbody) return;
    const list = displayedWorks();
    updateCountLabel(list);
    updatePagination(list);
    updateSortButtonsUI();

    const pageItems = slicePageItems(list);
    tbody.innerHTML = '';

    if (!pageItems.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 10;
      td.textContent = hasActiveFilters()
        ? 'Aucun tableau ne correspond aux filtres.'
        : 'Aucun tableau.';
      td.className = 'works-editor-empty';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    for (const work of pageItems) {
      const tr = document.createElement('tr');
      tr.dataset.workId = work.id;
      if (dirtyIds.has(work.id)) tr.classList.add('legend-editor-row--dirty');

      const tdThumb = document.createElement('td');
      tdThumb.className = 'works-thumb-cell';
      const img = document.createElement('img');
      img.className = 'works-thumb-img';
      img.alt = '';
      img.loading = 'lazy';
      const url = thumbUrlForWork(work);
      const fullSrc = fullImageUrlForWork(work);
      if (url) {
        img.src = url;
        img.onerror = function () {
          if (fullSrc && img.src !== fullSrc) {
            img.onerror = null;
            img.src = fullSrc;
            return;
          }
          img.classList.add('works-thumb-img--empty');
          if (isProductionHost()) {
            img.title =
              'Image absente sur le site — après import local, committez et publiez media/catalogue/ et media/works.json';
          }
        };
      } else if (fullSrc) {
        img.src = fullSrc;
      } else {
        img.classList.add('works-thumb-img--empty');
      }
      if (fullSrc) attachThumbPreview(img, fullSrc);
      tdThumb.appendChild(img);
      tr.appendChild(tdThumb);

      const tdId = document.createElement('td');
      tdId.className = 'works-code-cell';
      tdId.textContent = work.id;
      const origFilename = originalFilenameLabel(work);
      if (origFilename) tdId.title = origFilename;
      tr.appendChild(tdId);

      tr.appendChild(createTitleCell(work, tr));
      tr.appendChild(createYearCell(work, tr));

      tr.appendChild(
        createCodeSelectCell(work, tr, 'format_code', 'format', meta.formats, {
          placeholder: '—',
          labelMode: 'code-label',
          closedLabelMode: 'code',
          extraClass: 'works-select-compact works-select-format',
        })
      );
      tr.appendChild(
        createCodeSelectCell(work, tr, 'technique_code', 'technique', meta.techniques, {
          placeholder: '—',
          labelMode: 'code-label',
          closedLabelMode: 'code',
          extraClass: 'works-select-compact works-select-technique',
        })
      );
      tr.appendChild(createSeriesPickerCell(work, tr));
      tr.appendChild(
        createCodeSelectCell(work, tr, 'collector_code', 'collector', meta.collectors, {
          placeholder: '—',
          labelMode: 'name',
          extraClass: 'works-collector-select',
        })
      );
      tr.appendChild(
        createCodeSelectCell(work, tr, 'publication_status_code', 'publication', meta.publication_statuses, {
          placeholder: '—',
          allowEmpty: false,
          allowNew: false,
          labelMode: 'code-label',
          closedLabelMode: 'code',
          defaultValue: 'N',
          extraClass: 'works-select-compact works-select-pub',
        })
      );
      tr.appendChild(
        createCodeSelectCell(work, tr, 'photo_status_code', 'photo', meta.photo_statuses, {
          placeholder: '—',
          allowEmpty: true,
          allowNew: false,
          labelMode: 'code-label',
          closedLabelMode: 'code',
          extraClass: 'works-select-compact works-select-photo',
        })
      );

      tbody.appendChild(tr);
    }
    scheduleFormatRatioProbes(pageItems);
  }

  async function loadMeta() {
    const r = await apiFetch('/api/works/meta?token=' + encodeURIComponent(token));
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.error || 'meta failed');
    meta = j.meta || meta;
    sortMetaLists();
  }

  async function loadWorks() {
    const r = await apiFetch('/api/works?token=' + encodeURIComponent(token));
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.error || 'load failed');
    worksList = j.works || [];
    dirtyIds.clear();
    updateSaveBtn();
    currentPage = 0;
    renderTable();
  }

  async function saveWorks() {
    if (!dirtyIds.size) return;
    const payload = worksList
      .filter((w) => dirtyIds.has(w.id))
      .map((w) => ({
        id: w.id,
        title: w.title,
        year: w.year,
        format_code: w.format_code,
        technique_code: w.technique_code,
        publication_status_code: w.publication_status_code || 'N',
        photo_status_code: w.photo_status_code || null,
        collector_code: w.collector_code,
        width_cm: w.width_cm,
        height_cm: w.height_cm,
        sort_order: w.sort_order,
        series_codes: w.series_codes || [],
      }));

    setStatus('Enregistrement…');
    saveBtn.disabled = true;

    try {
      const r = await apiFetch('/api/works/save', {
        method: 'POST',
        body: JSON.stringify({ token, works: payload }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || 'save failed');
      worksList = j.works || worksList;
      dirtyIds.clear();
      updateSaveBtn();
      renderTable();
      setStatus(`${j.saved || payload.length} tableau(x) enregistré(s).`);
    } catch (e) {
      setStatus(String(e.message || e), true);
      updateSaveBtn();
    }
  }

  async function enterApp() {
    loginEl.hidden = true;
    appEl.hidden = false;
    deleteUnlocked = false;
    updateDeleteLockUi();
    bindStickyHeaderOffset();
    requestAnimationFrame(() => updateWorksStickyOffset());
    setStatus('Chargement…');
    try {
      await loadWorksCatalog();
      await loadMeta();
      await loadWorks();
      setStatus('');
      updateLocalStudioUi();
      await checkLocalApiCapabilities();
    } catch (e) {
      setStatus(String(e.message || e), true);
    }
  }

  async function showApiHint() {
    if (!apiHint) return;
    const base = await apiBase();
    apiHint.textContent = isLocalDevServer()
      ? 'API locale : ' + base
      : isOnlineApi(base)
        ? 'API Supabase : ' + base.replace(/^https:\/\//, '')
        : 'API : ' + base;
  }

  function formatApiError(err) {
    if (!err) return 'Erreur inconnue';
    if (typeof err === 'string') return err;
    if (err.message) return String(err.message);
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }

  const importDialog = document.getElementById('works-import-dialog');
  const importDialogTitle = document.getElementById('works-import-dialog-title');
  const importBtn = document.getElementById('works-import-btn');
  const importFilesEl = document.getElementById('works-import-files');
  const importCloseBtn = document.getElementById('works-import-close');
  const importCancelBtn = document.getElementById('works-import-cancel');
  const importSubmitBtn = document.getElementById('works-import-submit');
  const importStatusEl = document.getElementById('works-import-status');
  const importEnvNoticeEl = document.getElementById('works-import-env-notice');
  const importPreviewWrap = document.getElementById('works-import-preview-wrap');
  const importPreviewTbody = document.getElementById('works-import-preview-tbody');
  const importNextIdEl = document.getElementById('works-import-next-id');
  const importNextIdWrap = document.getElementById('works-import-next-id-wrap');
  const importPhotoStatusEl = document.getElementById('works-import-photo-status');
  const importPublishWrap = document.getElementById('works-import-publish-wrap');
  const importPublishAfterEl = document.getElementById('works-import-publish-after');
  const importCodesHintEl = document.getElementById('works-import-codes-hint');
  const publishBtn = document.getElementById('works-publish-btn');
  const publishDialog = document.getElementById('works-publish-dialog');
  const publishCloseBtn = document.getElementById('works-publish-close');
  const publishCancelBtn = document.getElementById('works-publish-cancel');
  const publishConfirmBtn = document.getElementById('works-publish-confirm');
  const publishFileListEl = document.getElementById('works-publish-file-list');
  const publishMessageEl = document.getElementById('works-publish-message');
  const publishStatusEl = document.getElementById('works-publish-status');

  /** @type {File[]} */
  let importSelectedFiles = [];
  /** @type {Array<object>} */
  let importPlan = [];
  /** @type {string[]} */
  let importPreviewObjectUrls = [];
  /** @type {Record<string, object>} */
  let importOverrides = {};
  let importPlanRefreshTimer = null;
  /** @type {string[]} */
  let pendingPublishWorkIds = [];

  function revokeImportPreviewObjectUrls() {
    for (const url of importPreviewObjectUrls) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
    }
    importPreviewObjectUrls = [];
  }

  function importPreviewUrlForFileName(name) {
    const file = importSelectedFiles.find((f) => f.name === name);
    if (!file) return '';
    const dot = file.name.lastIndexOf('.');
    if (dot < 0) return '';
    if (!RASTER_EXT.has(file.name.slice(dot).toLowerCase())) return '';
    const url = URL.createObjectURL(file);
    importPreviewObjectUrls.push(url);
    return url;
  }

  function updateLocalStudioUi() {
    const local = isLocalDevServer();
    if (publishBtn) publishBtn.hidden = !local;
    if (importPublishWrap) importPublishWrap.hidden = !local;
    if (importCodesHintEl) importCodesHintEl.hidden = !local;
    updateImportSubmitLabel();
  }

  function updateImportSubmitLabel() {
    if (!importSubmitBtn) return;
    if (!isLocalDevServer()) {
      importSubmitBtn.textContent = 'Simuler';
      return;
    }
    const publish = importPublishAfterEl && importPublishAfterEl.checked;
    importSubmitBtn.textContent = publish ? 'Importer et publier' : 'Importer';
  }

  function setImportOverride(originalName, field, value) {
    const name = String(originalName || '').trim();
    if (!name) return;
    if (!importOverrides[name]) importOverrides[name] = {};
    importOverrides[name][field] = value;
  }

  function getImportOverridesPayload() {
    return importOverrides;
  }

  function scheduleImportPlanRefresh() {
    clearTimeout(importPlanRefreshTimer);
    importPlanRefreshTimer = setTimeout(() => {
      refreshImportPlan().catch(() => {});
    }, 280);
  }

  function effectiveImportValue(row, field) {
    const ov = importOverrides[row.originalName];
    if (ov && field in ov && ov[field] != null) return ov[field];
    if (field === 'format_code') return row.formatCode || '';
    if (field === 'technique_code') return row.techniqueCode || '';
    if (field === 'series_codes') return row.seriesCodes || [];
    if (field === 'title') return row.title || '';
    return '';
  }

  function createImportCodeSelect(row, type) {
    const sel = document.createElement('select');
    sel.className = 'legend-select works-import-code-select';
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = '—';
    sel.appendChild(empty);
    const items = type === 'format' ? meta.formats : meta.techniques;
    for (const item of items || []) {
      const opt = document.createElement('option');
      opt.value = item.code;
      opt.textContent = item.label ? item.code + ' — ' + item.label : item.code;
      sel.appendChild(opt);
    }
    const field = type === 'format' ? 'format_code' : 'technique_code';
    sel.value = effectiveImportValue(row, field) || '';
    const err = String(row.error || '');
    if (
      (type === 'format' && err.includes('format')) ||
      (type === 'technique' && err.includes('technique'))
    ) {
      sel.classList.add('works-import-code-select--warn');
    }
    sel.addEventListener('change', () => {
      setImportOverride(row.originalName, field, sel.value || null);
      scheduleImportPlanRefresh();
    });
    return sel;
  }

  function createImportSeriesSelect(row) {
    const sel = document.createElement('select');
    sel.className = 'legend-select works-import-series-select';
    sel.multiple = true;
    sel.size = 3;
    sel.title = 'Maintenir Ctrl (Cmd) pour sélectionner plusieurs séries';
    for (const s of meta.series || []) {
      const opt = document.createElement('option');
      opt.value = s.code;
      opt.textContent = s.label ? s.code + ' — ' + s.label : s.code;
      sel.appendChild(opt);
    }
    const selected = new Set(
      (effectiveImportValue(row, 'series_codes') || []).map((c) => String(c).toUpperCase())
    );
    for (const opt of sel.options) {
      opt.selected = selected.has(opt.value);
    }
    if (String(row.error || '').includes('série')) {
      sel.classList.add('works-import-code-select--warn');
    }
    sel.addEventListener('change', () => {
      const codes = [...sel.selectedOptions].map((o) => o.value);
      setImportOverride(row.originalName, 'series_codes', codes);
      scheduleImportPlanRefresh();
    });
    return sel;
  }

  function updateImportEnvNotice() {
    const el = importEnvNoticeEl;
    if (!el) return;
    if (isLocalDevServer()) {
      el.className = 'works-import-env-notice works-import-env-notice--local';
      el.innerHTML =
        '<strong class="works-import-env-title">Studio import (API locale)</strong>' +
        '<p>Lancez <code>npm run works:import</code> pour ouvrir cet écran automatiquement.</p>' +
        '<p>Corrigez format, technique ou série dans le tableau si besoin, puis <strong>Importer et publier</strong> ' +
        'enregistre les fichiers, Supabase, <code>works.json</code> et pousse sur GitHub Pages.</p>';
      return;
    }
    el.className = 'works-import-env-notice works-import-env-notice--online';
    el.innerHTML =
      '<strong class="works-import-env-title">Simulation d’import — aucune écriture en ligne</strong>' +
      '<p>Vérifiez les codes MS, corrigez format / technique / série dans le tableau, puis simulez.</p>' +
      '<p><strong>Pour importer et publier sur le site</strong>&nbsp;:</p>' +
      '<ol>' +
      '<li><code>npm run works:import</code> dans le projet (ou <code>npm run works:api</code>)</li>' +
      '<li>Importer et publier depuis <code>http://127.0.0.1:47835/</code></li>' +
      '</ol>';
  }

  function updateImportDialogForEnv() {
    const local = isLocalDevServer();
    if (importDialogTitle) {
      importDialogTitle.textContent = local ? 'Importer des œuvres' : 'Simulation d’import';
    }
    if (importSubmitBtn) importSubmitBtn.hidden = false;
    updateLocalStudioUi();
  }

  async function loadNextSequentialId() {
    if (!importNextIdEl) return;
    try {
      const r = await apiFetch('/api/works/next-id?token=' + encodeURIComponent(token));
      const j = await r.json();
      if (j.ok) importNextIdEl.textContent = j.next_id || '—';
    } catch {
      importNextIdEl.textContent = '—';
    }
  }

  function renderImportPhotoStatusSelect() {
    if (!importPhotoStatusEl) return;
    const prev = importPhotoStatusEl.value;
    importPhotoStatusEl.innerHTML = '';
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = '—';
    importPhotoStatusEl.appendChild(empty);
    for (const s of meta.photo_statuses || []) {
      const opt = document.createElement('option');
      opt.value = s.code;
      opt.textContent = s.label ? s.code + ' — ' + s.label : s.code;
      importPhotoStatusEl.appendChild(opt);
    }
    importPhotoStatusEl.value = prev || '';
  }

  function getImportPhotoStatusCode() {
    if (!importPhotoStatusEl) return null;
    const code = String(importPhotoStatusEl.value || '').trim().toUpperCase();
    return code || null;
  }

  function getImportMode() {
    const checked = document.querySelector('input[name="works-import-mode"]:checked');
    return checked && checked.value === 'update' ? 'update' : 'add';
  }

  function updateImportModeUi() {
    const mode = getImportMode();
    if (importNextIdWrap) importNextIdWrap.hidden = mode === 'update';
  }

  function renderImportPreview(plan) {
    if (!importPreviewTbody || !importPreviewWrap || !importSubmitBtn) return;
    revokeImportPreviewObjectUrls();
    importPreviewTbody.innerHTML = '';
    let okCount = 0;
    for (const row of plan) {
      const tr = document.createElement('tr');
      if (row.error) tr.className = 'works-import-preview-row--error';
      else if (row.warning) tr.className = 'works-import-preview-row--warn';
      else okCount += 1;

      const tdThumb = document.createElement('td');
      tdThumb.className = 'works-import-preview-thumb-cell';
      const previewUrl = importPreviewUrlForFileName(row.originalName || '');
      if (previewUrl) {
        const img = document.createElement('img');
        img.className = 'works-import-preview-thumb';
        img.alt = '';
        img.src = previewUrl;
        tdThumb.appendChild(img);
      }
      tr.appendChild(tdThumb);

      const tdFile = document.createElement('td');
      tdFile.textContent = row.originalName || '';
      tr.appendChild(tdFile);

      const tdCode = document.createElement('td');
      tdCode.textContent = row.workId || '—';
      if (row.effectiveMode === 'update') {
        tdCode.textContent += ' (maj image)';
      } else if (row.effectiveMode === 'add' && row.importMode === 'update') {
        tdCode.textContent += ' (ajout)';
      }
      tr.appendChild(tdCode);

      const tdImage = document.createElement('td');
      tdImage.textContent = row.catalogueBasename || '—';
      tr.appendChild(tdImage);

      const tdSeries = document.createElement('td');
      tdSeries.className = 'works-import-code-cell';
      if (row.effectiveMode === 'update') {
        tdSeries.textContent = '—';
      } else {
        tdSeries.appendChild(createImportSeriesSelect(row));
      }
      tr.appendChild(tdSeries);

      const tdFormat = document.createElement('td');
      tdFormat.className = 'works-import-code-cell';
      if (row.effectiveMode === 'update') {
        tdFormat.textContent = '—';
      } else {
        tdFormat.appendChild(createImportCodeSelect(row, 'format'));
      }
      tr.appendChild(tdFormat);

      const tdTechnique = document.createElement('td');
      tdTechnique.className = 'works-import-code-cell';
      if (row.effectiveMode === 'update') {
        tdTechnique.textContent = '—';
      } else {
        tdTechnique.appendChild(createImportCodeSelect(row, 'technique'));
      }
      tr.appendChild(tdTechnique);

      const tdTitle = document.createElement('td');
      tdTitle.className = 'works-import-title-cell';
      if (row.effectiveMode === 'update') {
        tdTitle.textContent = '—';
      } else {
        const titleInput = document.createElement('input');
        titleInput.type = 'text';
        titleInput.className = 'works-import-title-input';
        titleInput.value = effectiveImportValue(row, 'title') || '';
        titleInput.addEventListener('change', () => {
          setImportOverride(row.originalName, 'title', titleInput.value.trim() || null);
          scheduleImportPlanRefresh();
        });
        tdTitle.appendChild(titleInput);
      }
      tr.appendChild(tdTitle);

      const tdErr = document.createElement('td');
      tdErr.className = 'works-import-format-ratio-cell';
      const msgs = [];
      if (row.error) msgs.push(row.error);
      else if (row.warning) msgs.push(row.warning);
      tdErr.textContent = msgs.join(' · ');
      tr.appendChild(tdErr);

      if (row.formatCode && previewUrl && row.effectiveMode !== 'update') {
        tr.dataset.importFormat = row.formatCode;
        tr.dataset.importPreviewUrl = previewUrl;
      }

      importPreviewTbody.appendChild(tr);
    }
    importPreviewWrap.hidden = !plan.length;
    probeImportFormatRatios(plan);
    if (importSubmitBtn) {
      importSubmitBtn.disabled = okCount === 0;
    }
    if (importCodesHintEl) {
      importCodesHintEl.hidden =
        !isLocalDevServer() || !plan.some((r) => r.error && /inconnu/i.test(String(r.error)));
    }
    updateImportSubmitLabel();
    if (importStatusEl) {
      if (!plan.length) {
        importStatusEl.textContent = '';
      } else {
        const errCount = plan.filter((r) => r.error).length;
        const warnCount = plan.filter((r) => r.warning && !r.error).length;
        let msg = okCount + ' prêt(s) sur ' + plan.length;
        if (errCount) msg += ' · ' + errCount + ' erreur(s)';
        if (warnCount) msg += ' · ' + warnCount + ' avertissement(s)';
        if (!isLocalDevServer()) msg += ' — simulation (aucune écriture)';
        else if (okCount === 0 && plan.length) {
          msg += ' — corrigez format, technique ou série pour activer l’import';
        } else if (importPublishAfterEl && importPublishAfterEl.checked) {
          msg += ' — puis publication git push';
        }
        importStatusEl.textContent = msg;
      }
      importStatusEl.classList.remove('legend-editor-api-hint--error');
    }
  }

  async function refreshImportPlan() {
    if (!importSelectedFiles.length) {
      importPlan = [];
      renderImportPreview([]);
      return;
    }
    if (importStatusEl) importStatusEl.textContent = 'Analyse des fichiers…';
    const files = importSelectedFiles.map((f) => ({ originalName: f.name }));
    const r = await apiFetch('/api/works/import/plan', {
      method: 'POST',
      body: JSON.stringify({
        token,
        import_mode: getImportMode(),
        photo_status_code: getImportPhotoStatusCode(),
        files,
        overrides: getImportOverridesPayload(),
      }),
    });
    const j = await r.json();
    if (!r.ok || !j.ok) {
      if (importStatusEl) {
        let errMsg = formatApiError(j.error) || 'aperçu impossible';
        if (errMsg === 'not found' || r.status === 404) {
          errMsg =
            'API locale obsolète ou arrêtée — arrêtez le terminal (Ctrl+C) puis relancez npm run works:api';
        }
        importStatusEl.textContent = errMsg;
        importStatusEl.classList.add('legend-editor-api-hint--error');
      }
      importPlan = [];
      renderImportPreview([]);
      return;
    }
    importPlan = j.plan || [];
    renderImportPreview(importPlan);
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const s = String(reader.result || '');
        const comma = s.indexOf(',');
        resolve(comma >= 0 ? s.slice(comma + 1) : s);
      };
      reader.onerror = () => reject(reader.error || new Error('lecture fichier'));
      reader.readAsDataURL(file);
    });
  }

  async function openImportDialog() {
    if (!importDialog) return;
    revokeImportPreviewObjectUrls();
    importSelectedFiles = [];
    importPlan = [];
    importOverrides = {};
    if (importFilesEl) importFilesEl.value = '';
    updateImportModeUi();
    updateImportDialogForEnv();
    renderImportPhotoStatusSelect();
    updateImportEnvNotice();
    await loadNextSequentialId();
    renderImportPreview([]);
    if (importStatusEl) {
      importStatusEl.textContent = '';
      importStatusEl.classList.remove('legend-editor-api-hint--error');
    }
    importDialog.showModal();
  }

  async function loadPublishPreview(workIds) {
    const qs =
      '/api/works/publish/preview?token=' +
      encodeURIComponent(token) +
      (workIds && workIds.length
        ? '&work_ids=' + encodeURIComponent(workIds.join(','))
        : '');
    const r = await apiFetch(qs);
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(formatApiError(j.error) || 'aperçu publication impossible');
    return j;
  }

  function defaultPublishMessage(workIds) {
    if (!workIds || !workIds.length) {
      return 'Publie médias catalogue sur mariesallantin.art';
    }
    if (workIds.length === 1) {
      return 'Publie œuvre ' + workIds[0] + ' sur mariesallantin.art';
    }
    return (
      'Publie œuvres ' + workIds[0] + '–' + workIds[workIds.length - 1] + ' sur mariesallantin.art'
    );
  }

  async function openPublishDialog(workIds) {
    if (!isLocalDevServer() || !publishDialog) return;
    pendingPublishWorkIds = workIds || [];
    if (publishStatusEl) {
      publishStatusEl.textContent = '';
      publishStatusEl.classList.remove('legend-editor-api-hint--error');
    }
    if (publishFileListEl) publishFileListEl.innerHTML = '';
    if (publishMessageEl) {
      publishMessageEl.value = defaultPublishMessage(pendingPublishWorkIds);
    }
    try {
      const preview = await loadPublishPreview(pendingPublishWorkIds);
      if (publishFileListEl) {
        publishFileListEl.innerHTML = '';
        for (const p of preview.paths || []) {
          const li = document.createElement('li');
          li.textContent = p;
          publishFileListEl.appendChild(li);
        }
        if (!preview.paths || !preview.paths.length) {
          const li = document.createElement('li');
          li.textContent = 'Aucun fichier en attente de publication.';
          publishFileListEl.appendChild(li);
        }
      }
      if (publishConfirmBtn) {
        publishConfirmBtn.disabled = !preview.paths || !preview.paths.length;
      }
    } catch (e) {
      if (publishStatusEl) {
        publishStatusEl.textContent = formatApiError(e);
        publishStatusEl.classList.add('legend-editor-api-hint--error');
      }
      if (publishConfirmBtn) publishConfirmBtn.disabled = true;
    }
    publishDialog.showModal();
  }

  function formatLocalApiStaleError(context) {
    return (
      context +
      ' — API locale obsolète : arrêtez le terminal (Ctrl+C), relancez npm run works:import, ou publiez avec npm run works:publish'
    );
  }

  async function checkLocalApiCapabilities() {
    if (!isLocalDevServer()) return;
    try {
      const r = await fetch(window.location.origin + '/api/health', { cache: 'no-store' });
      if (!r.ok) return;
      const j = await r.json();
      if (j.ok && j.features && j.features.publish === false) {
        setStatus(formatLocalApiStaleError('Publication indisponible'), true);
      }
    } catch {
      /* ignore */
    }
  }

  async function runPublish({ workIds, message, closeDialog }) {
    if (!isLocalDevServer()) {
      throw new Error('publication réservée à l’API locale — npm run works:import');
    }
    const ids = (workIds || []).map((id) => String(id).trim().toUpperCase()).filter(Boolean);
    const r = await apiFetch('/api/works/publish', {
      method: 'POST',
      body: JSON.stringify({
        token,
        work_ids: ids,
        message: message || defaultPublishMessage(ids),
      }),
    });
    const j = await r.json();
    if (!r.ok || !j.ok) {
      const err = formatApiError(j.error) || 'publication échouée';
      if (r.status === 404 || err === 'not found') {
        throw new Error(formatLocalApiStaleError('Publication impossible'));
      }
      throw new Error(err);
    }
    if (closeDialog && publishDialog) publishDialog.close();
    return j;
  }

  async function publishImportedWorks(workIds) {
    if (!workIds.length) return null;
    setStatus('Publication sur mariesallantin.art…');
    try {
      const j = await runPublish({
        workIds,
        message: defaultPublishMessage(workIds),
        closeDialog: true,
      });
      if (j.pushed) {
        setStatus(
          workIds.length +
            ' œuvre(s) importée(s) et publiée(s) — vignettes visibles sur mariesallantin.art dans 1–2 min.'
        );
      } else {
        setStatus(
          workIds.length +
            ' œuvre(s) importée(s) — rien à publier (fichiers déjà sur le dépôt).'
        );
      }
      return j;
    } catch (e) {
      setStatus(
        'Import terminé mais publication échouée : ' +
          formatApiError(e) +
          ' — utilisez « Publier médias ».',
        true
      );
      return null;
    }
  }

  async function runWorksImport() {
    if (!importSelectedFiles.length || !importSubmitBtn) return;
    if (!isLocalDevServer()) {
      const ok = importPlan.filter((r) => !r.error).length;
      if (importStatusEl) {
        importStatusEl.textContent =
          ok +
          ' fichier(s) prêt(s) — pour importer et publier, lancez npm run works:import en local.';
      }
      return;
    }
    const importMode = getImportMode();
    const photoStatusCode = getImportPhotoStatusCode();
    const batchSize = isLocalDevServer() ? 12 : 2;
    importSubmitBtn.disabled = true;
    if (importStatusEl) {
      importStatusEl.textContent = 'Import en cours…';
      importStatusEl.classList.remove('legend-editor-api-hint--error');
    }

    let lastWorks = worksList;
    let totalOk = 0;
    const allImported = [];

    try {
      for (let i = 0; i < importSelectedFiles.length; i += batchSize) {
        const batch = importSelectedFiles.slice(i, i + batchSize);
        const files = [];
        for (const f of batch) {
          files.push({
            originalName: f.name,
            contentBase64: await fileToBase64(f),
          });
        }
        const r = await apiFetch('/api/works/import', {
          method: 'POST',
          body: JSON.stringify({
            token,
            import_mode: importMode,
            photo_status_code: photoStatusCode,
            files,
            overrides: getImportOverridesPayload(),
          }),
        });
        const j = await r.json();
        if (!r.ok || !j.ok) {
          throw new Error(formatApiError(j.error) || 'import échoué');
        }
        lastWorks = j.works || lastWorks;
        totalOk += (j.imported || []).filter((row) => row.status === 'ok').length;
        allImported.push(...(j.imported || []));
      }

      worksList = lastWorks;
      dirtyIds.clear();
      await reloadWorksCatalog();
      mergeImportMediaPaths(allImported);
      const list = sortWorks(filterWorks(worksList));
      const pageSize = getPageSize();
      currentPage = Math.max(0, Math.ceil(list.length / pageSize) - 1);
      updateSaveBtn();
      renderTable();
      if (importDialog) importDialog.close();

      const importedIds = allImported
        .filter((row) => row.status === 'ok' && row.workId)
        .map((row) => String(row.workId).toUpperCase());

      if (importPublishAfterEl && importPublishAfterEl.checked && importedIds.length) {
        await publishImportedWorks(importedIds);
      } else {
        let msg = totalOk + ' œuvre(s) importée(s).';
        if (isLocalDevServer()) {
          msg += ' Cochez « Publier après import » ou utilisez « Publier médias » pour le site en ligne.';
        }
        setStatus(msg);
      }
    } catch (e) {
      if (importStatusEl) {
        importStatusEl.textContent = formatApiError(e);
        importStatusEl.classList.add('legend-editor-api-hint--error');
      }
    } finally {
      if (importSubmitBtn) importSubmitBtn.disabled = false;
    }
  }

  function bindEvents() {
    loginBtn.addEventListener('click', async () => {
      const pass = passEl.value.trim();
      const ec = AUTH();
      if (!ec || !ec.validatePassword(pass)) {
        loginErr.hidden = false;
        loginErr.textContent = 'Mot de passe incorrect.';
        return;
      }
      loginErr.hidden = true;
      token = pass;
      ec.setSessionToken(pass);
      await enterApp();
    });

    passEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') loginBtn.click();
    });

    reloadBtn.addEventListener('click', async () => {
      if (dirtyIds.size && !window.confirm('Recharger et perdre les modifications non enregistrées ?')) {
        return;
      }
      setStatus('Rechargement…');
      try {
        workMediaById = null;
        workImageDimensionsById = null;
        await loadWorksCatalog();
        await loadMeta();
        await loadWorks();
        setStatus('Données rechargées.');
      } catch (e) {
        setStatus(String(e.message || e), true);
      }
    });

    saveBtn.addEventListener('click', () => saveWorks());

    deleteLockBtn?.addEventListener('click', () => {
      deleteUnlocked = !deleteUnlocked;
      updateDeleteLockUi();
      renderTable();
    });

    importBtn?.addEventListener('click', () => {
      openImportDialog().catch((e) => setStatus(formatApiError(e), true));
    });

    importCloseBtn?.addEventListener('click', () => importDialog?.close());
    importCancelBtn?.addEventListener('click', () => importDialog?.close());

    importFilesEl?.addEventListener('change', () => {
      importSelectedFiles = importFilesEl.files ? [...importFilesEl.files] : [];
      refreshImportPlan().catch((e) => {
        if (importStatusEl) {
          importStatusEl.textContent = formatApiError(e);
          importStatusEl.classList.add('legend-editor-api-hint--error');
        }
      });
    });

    importPhotoStatusEl?.addEventListener('change', () => {
      refreshImportPlan().catch(() => {});
    });

    document.querySelectorAll('input[name="works-import-mode"]').forEach((el) => {
      el.addEventListener('change', () => {
        updateImportModeUi();
        refreshImportPlan().catch(() => {});
      });
    });

    importSubmitBtn?.addEventListener('click', () => {
      runWorksImport().catch((e) => setStatus(formatApiError(e), true));
    });

    importPublishAfterEl?.addEventListener('change', () => updateImportSubmitLabel());

    publishBtn?.addEventListener('click', () => {
      openPublishDialog([]).catch((e) => setStatus(formatApiError(e), true));
    });

    publishCloseBtn?.addEventListener('click', () => publishDialog?.close());
    publishCancelBtn?.addEventListener('click', () => publishDialog?.close());

    publishConfirmBtn?.addEventListener('click', async () => {
      if (!publishConfirmBtn) return;
      publishConfirmBtn.disabled = true;
      if (publishStatusEl) {
        publishStatusEl.textContent = 'Publication en cours (git push)…';
        publishStatusEl.classList.remove('legend-editor-api-hint--error');
      }
      try {
        const j = await runPublish({
          workIds: pendingPublishWorkIds,
          message: publishMessageEl ? publishMessageEl.value : '',
          closeDialog: false,
        });
        if (publishStatusEl) {
          publishStatusEl.textContent = j.pushed
            ? 'Publié — le site sera à jour dans 1–2 minutes.'
            : 'Rien à publier (dépôt déjà à jour).';
        }
        setStatus(
          j.pushed
            ? 'Médias publiés sur mariesallantin.art.'
            : 'Aucun fichier média en attente de publication.'
        );
        setTimeout(() => publishDialog?.close(), 1200);
      } catch (e) {
        if (publishStatusEl) {
          publishStatusEl.textContent = formatApiError(e);
          publishStatusEl.classList.add('legend-editor-api-hint--error');
        }
      } finally {
        publishConfirmBtn.disabled = false;
      }
    });

    filterEl?.addEventListener('input', () => {
      filterText = filterEl.value;
      currentPage = 0;
      renderTable();
    });

    seriesFilterEl?.addEventListener('input', () => {
      seriesFilterText = seriesFilterEl.value;
      currentPage = 0;
      renderTable();
    });

    document.querySelectorAll('.works-sort-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        sortColumn = btn.getAttribute('data-sort-key') || 'order';
        currentPage = 0;
        if (pageSizeEl) pageSizeEl.value = 'all';
        renderTable();
      });
    });

    pagePrevBtn?.addEventListener('click', () => {
      if (currentPage > 0) {
        currentPage -= 1;
        renderTable();
      }
    });

    pageNextBtn?.addEventListener('click', () => {
      const pages = pageCount(filteredWorks());
      if (currentPage < pages - 1) {
        currentPage += 1;
        renderTable();
      }
    });

    pageSizeEl?.addEventListener('change', () => {
      currentPage = 0;
      renderTable();
    });

    document.addEventListener('click', () => {
      closeAllSeriesPanels();
    });
  }

  async function init() {
    bindEvents();
    await showApiHint();
    if (AUTH() && AUTH().hasSession()) {
      token = AUTH().getSessionToken() || '';
      if (passEl) passEl.value = token;
      await enterApp();
    }
  }

  init();
})();
