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
  const RASTER_EXT = new Set([
    '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.avif',
  ]);

  let siteConfig = null;
  let resolvedApiBase = '';
  /** @type {Map<string, string> | null} */
  let workMediaById = null;
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

  function thumbUrlForWorkId(workId) {
    if (!workId || !workMediaById || !workMediaById.has(workId)) return '';
    return thumbUrlForMedia(workMediaById.get(workId));
  }

  async function loadWorksCatalog() {
    if (workMediaById) return;
    workMediaById = new Map();
    try {
      const r = await fetch(MEDIA_BASE + 'works.json');
      if (r.ok) {
        const j = await r.json();
        for (const w of j.works || []) {
          if (w.id && w.media) workMediaById.set(w.id, String(w.media));
        }
      }
    } catch {
      /* optionnel */
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
        return String(work.photo_status_code || 'OK').trim().toUpperCase();
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

  function sortMetaLists() {
    meta.formats = sortByCode(meta.formats);
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

  function usedFormatCodes() {
    const used = new Set();
    for (const w of worksList) {
      if (w.format_code) used.add(w.format_code);
    }
    return used;
  }

  function usedTechniqueCodes() {
    const used = new Set();
    for (const w of worksList) {
      if (w.technique_code) used.add(w.technique_code);
    }
    return used;
  }

  function appendSelectSeparator(selectEl) {
    const sep = document.createElement('option');
    sep.disabled = true;
    sep.value = '';
    sep.textContent = '────────';
    sep.className = 'works-select-separator';
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
   * @param {{ placeholder?: string, allowEmpty?: boolean, allowNew?: boolean, labelMode?: string, currentValue?: string, groupUsedFirst?: boolean, usedCodesSet?: Set<string> }} cfg
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
    } = cfg || {};

    selectEl.innerHTML = '';
    if (allowEmpty) {
      const optEmpty = document.createElement('option');
      optEmpty.value = '';
      optEmpty.textContent = placeholder;
      selectEl.appendChild(optEmpty);
    }

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

    if (allowNew) {
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
    td.appendChild(input);
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
    td.className = 'works-select-cell';
    const select = document.createElement('select');
    select.className = 'legend-select works-row-select' + (cfg.extraClass ? ' ' + cfg.extraClass : '');

    fillSelectOptions(select, options, {
      placeholder: cfg.placeholder,
      allowEmpty: cfg.allowEmpty !== false,
      allowNew: cfg.allowNew !== false,
      labelMode: cfg.labelMode || 'code-label',
      currentValue: work[field] || cfg.defaultValue || '',
      groupUsedFirst: kind === 'format' || kind === 'technique',
      usedCodesSet:
        kind === 'format'
          ? usedFormatCodes()
          : kind === 'technique'
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
      if (kind === 'format') applyFormatDimensionsToWork(work, work[field]);
      markDirty(work.id, tr);
    });

    td.appendChild(select);
    return td;
  }

  function fullImageUrlForWorkId(workId) {
    if (!workId || !workMediaById || !workMediaById.has(workId)) return '';
    return MEDIA_BASE + encodeMediaPath(workMediaById.get(workId));
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
      if (dirtyIds.has(work.id)) tr.classList.add('legend-editor-row--dirty');

      const tdThumb = document.createElement('td');
      tdThumb.className = 'works-thumb-cell';
      const img = document.createElement('img');
      img.className = 'works-thumb-img';
      img.alt = '';
      img.loading = 'lazy';
      const url = thumbUrlForWorkId(work.id);
      if (url) {
        img.src = url;
        img.onerror = function () {
          const full = workMediaById && workMediaById.get(work.id);
          if (full) {
            img.onerror = null;
            img.src = MEDIA_BASE + encodeMediaPath(full);
          }
        };
      } else {
        img.classList.add('works-thumb-img--empty');
      }
      const fullSrc = fullImageUrlForWorkId(work.id);
      if (fullSrc) attachThumbPreview(img, fullSrc);
      tdThumb.appendChild(img);
      tr.appendChild(tdThumb);

      const tdId = document.createElement('td');
      tdId.className = 'works-code-cell';
      tdId.textContent = work.id;
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
          placeholder: 'Aucun',
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
          allowEmpty: false,
          allowNew: false,
          labelMode: 'code-label',
          closedLabelMode: 'code',
          defaultValue: 'OK',
          extraClass: 'works-select-compact works-select-photo',
        })
      );

      tbody.appendChild(tr);
    }
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
        photo_status_code: w.photo_status_code || 'OK',
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
    bindStickyHeaderOffset();
    requestAnimationFrame(() => updateWorksStickyOffset());
    setStatus('Chargement…');
    try {
      await loadWorksCatalog();
      await loadMeta();
      await loadWorks();
      setStatus('');
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
        await loadMeta();
        await loadWorks();
        setStatus('Données rechargées.');
      } catch (e) {
        setStatus(String(e.message || e), true);
      }
    });

    saveBtn.addEventListener('click', () => saveWorks());

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
