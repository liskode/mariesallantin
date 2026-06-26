/**
 * Éditeur tableaux (œuvres) — API locale (dev) ou Edge Function Supabase (en ligne).
 */
(function () {
  const EDIT_PASS = 'MS75';
  const AUTH_KEY = 'works_edit_ok';
  const MEDIA_BASE = 'media/';
  const PAGE_SIZE = 50;
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
  let currentPage = 0;
  /** @type {string | null} */
  let activeEditId = null;

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
  const filterEl = document.getElementById('works-filter');
  const paginationEl = document.getElementById('works-pagination');
  const pagePrevBtn = document.getElementById('works-page-prev');
  const pageNextBtn = document.getElementById('works-page-next');
  const pageInfoEl = document.getElementById('works-page-info');
  const editDialog = document.getElementById('works-edit-dialog');
  const editBackdrop = document.getElementById('works-edit-backdrop');
  const editCloseBtn = document.getElementById('works-edit-close');
  const editForm = document.getElementById('works-edit-form');
  const editImage = document.getElementById('works-edit-image');
  const editIdEl = document.getElementById('works-edit-id');
  const editTitleInput = document.getElementById('works-edit-title-input');
  const editYearInput = document.getElementById('works-edit-year');
  const editFormatSel = document.getElementById('works-edit-format');
  const editWidthInput = document.getElementById('works-edit-width');
  const editHeightInput = document.getElementById('works-edit-height');
  const editTechniqueSel = document.getElementById('works-edit-technique');
  const editSeriesToggle = document.getElementById('works-edit-series-toggle');
  const editSeriesPanel = document.getElementById('works-edit-series-panel');
  const editSeriesAddSel = document.getElementById('works-edit-series-add');
  const editCollectorSel = document.getElementById('works-edit-collector');
  const editPublicationSel = document.getElementById('works-edit-publication');
  const editPhotoSel = document.getElementById('works-edit-photo');
  const editErrorEl = document.getElementById('works-edit-error');

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
    if (!saveBtn) return;
    const dirty = dirtyIds.size > 0;
    saveBtn.disabled = !dirty;
    saveBtn.classList.toggle('legend-editor-btn--save-dirty', dirty);
    saveBtn.classList.toggle('legend-editor-btn--save-clean', !dirty);
  }

  function markDirty(id) {
    dirtyIds.add(id);
    updateSaveBtn();
  }

  function formatByCode(code) {
    return meta.formats.find((f) => f.code === code) || null;
  }

  function labelForCode(list, code) {
    if (!code) return '—';
    const item = list.find((x) => x.code === code);
    return item && item.label ? item.label : code;
  }

  function fillCodeSelect(selectEl, options, placeholder, allowEmpty, allowNew) {
    if (!selectEl) return;
    const previous = selectEl.value;
    selectEl.innerHTML = '';
    if (allowEmpty !== false) {
      const optEmpty = document.createElement('option');
      optEmpty.value = '';
      optEmpty.textContent = placeholder;
      selectEl.appendChild(optEmpty);
    }
    options.forEach((x) => {
      const o = document.createElement('option');
      o.value = x.code;
      o.textContent = x.label ? `${x.code} — ${x.label}` : x.code;
      selectEl.appendChild(o);
    });
    if (allowNew !== false) {
      const optNew = document.createElement('option');
      optNew.value = NEW_OPTION_VALUE;
      optNew.textContent = '— Nouveau —';
      optNew.className = 'works-select-new-option';
      selectEl.appendChild(optNew);
    }
    if (previous && previous !== NEW_OPTION_VALUE) {
      selectEl.value = previous;
    }
  }

  function renderSeriesPanel(selectedCodes) {
    if (!editSeriesPanel) return;
    editSeriesPanel.innerHTML = '';
    (meta.series || []).forEach((x) => {
      const label = document.createElement('label');
      label.className = 'catalogue-series-option';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = x.code;
      cb.checked = selectedCodes.includes(x.code);
      label.appendChild(cb);
      label.appendChild(document.createTextNode(x.label ? `${x.code} — ${x.label}` : x.code));
      editSeriesPanel.appendChild(label);
    });
    renderSeriesAddSelect(selectedCodes);
  }

  function renderSeriesAddSelect(selectedCodes) {
    if (!editSeriesAddSel) return;
    const selected = new Set(selectedCodes || []);
    editSeriesAddSel.innerHTML = '';
    const optEmpty = document.createElement('option');
    optEmpty.value = '';
    optEmpty.textContent = 'Ajouter une série…';
    editSeriesAddSel.appendChild(optEmpty);
    (meta.series || []).forEach((x) => {
      if (selected.has(x.code)) return;
      const o = document.createElement('option');
      o.value = x.code;
      o.textContent = x.label ? `${x.code} — ${x.label}` : x.code;
      editSeriesAddSel.appendChild(o);
    });
    const optNew = document.createElement('option');
    optNew.value = NEW_OPTION_VALUE;
    optNew.textContent = '— Nouveau —';
    optNew.className = 'works-select-new-option';
    editSeriesAddSel.appendChild(optNew);
  }

  function checkSeriesCode(code) {
    if (!editSeriesPanel || !code) return;
    const cb = editSeriesPanel.querySelector(`input[type="checkbox"][value="${CSS.escape(code)}"]`);
    if (cb) cb.checked = true;
    updateSeriesToggleText();
    renderSeriesAddSelect(readSelectedSeriesCodes());
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
      if (editErrorEl) {
        editErrorEl.hidden = false;
        editErrorEl.textContent = String(e.message || e);
      }
      return true;
    }
    if (!created) return true;
    populateEditSelects();
    selectEl.value = created;
    selectEl.dataset.prevValue = created;
    if (kind === 'format') applyFormatDimensions(created);
    if (editErrorEl) {
      editErrorEl.hidden = true;
      editErrorEl.textContent = '';
    }
    setStatus(`${kind === 'format' ? 'Format' : kind === 'technique' ? 'Technique' : 'Collectionneur'} ${created} créé.`);
    return true;
  }

  function bindSelectNewHandler(selectEl, kind, onRegularChange) {
    if (!selectEl) return;
    selectEl.addEventListener('focus', () => {
      selectEl.dataset.prevValue = selectEl.value;
    });
    selectEl.addEventListener('change', async () => {
      if (await handleSelectNew(selectEl, kind)) return;
      if (onRegularChange) onRegularChange();
    });
  }

  function readSelectedSeriesCodes() {
    if (!editSeriesPanel) return [];
    return [...editSeriesPanel.querySelectorAll('input[type="checkbox"]:checked')]
      .map((el) => String(el.value || '').trim().toUpperCase())
      .filter(Boolean);
  }

  function updateSeriesToggleText() {
    if (!editSeriesToggle) return;
    const selected = readSelectedSeriesCodes();
    editSeriesToggle.textContent = selected.length ? selected.join(', ') : 'Choisir…';
  }

  function filteredWorks() {
    const q = filterText.trim().toLowerCase();
    if (!q) return worksList;
    return worksList.filter((w) => {
      const id = String(w.id || '').toLowerCase();
      const title = String(w.title || '').toLowerCase();
      return id.includes(q) || title.includes(q);
    });
  }

  function pageCount(list) {
    return Math.max(1, Math.ceil(list.length / PAGE_SIZE));
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
    const pages = pageCount(list);
    if (currentPage >= pages) currentPage = Math.max(0, pages - 1);
    const show = pages > 1;
    if (paginationEl) paginationEl.hidden = !show;
    if (pageInfoEl) {
      pageInfoEl.textContent = show
        ? `Page ${currentPage + 1} / ${pages}`
        : '';
    }
    if (pagePrevBtn) pagePrevBtn.disabled = currentPage <= 0;
    if (pageNextBtn) pageNextBtn.disabled = currentPage >= pages - 1;
  }

  function truncate(text, max) {
    const s = String(text || '').trim();
    if (s.length <= max) return s;
    return s.slice(0, max - 1) + '…';
  }

  function renderTable() {
    if (!tbody) return;
    const list = filteredWorks();
    updateCountLabel(list);
    updatePagination(list);

    const start = currentPage * PAGE_SIZE;
    const pageItems = list.slice(start, start + PAGE_SIZE);
    tbody.innerHTML = '';

    if (!pageItems.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 11;
      td.textContent = filterText.trim()
        ? 'Aucun tableau ne correspond au filtre.'
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
      tdThumb.appendChild(img);
      tr.appendChild(tdThumb);

      const tdId = document.createElement('td');
      tdId.className = 'works-code-cell';
      tdId.textContent = work.id;
      tr.appendChild(tdId);

      const tdTitle = document.createElement('td');
      tdTitle.className = 'works-title-cell';
      tdTitle.textContent = truncate(work.title, 48) || '—';
      tdTitle.title = work.title || '';
      tr.appendChild(tdTitle);

      const tdYear = document.createElement('td');
      tdYear.className = 'works-year-cell';
      tdYear.textContent = work.year != null ? String(work.year) : '—';
      tr.appendChild(tdYear);

      const tdFormat = document.createElement('td');
      tdFormat.className = 'works-code-ref-cell';
      tdFormat.textContent = work.format_code || '—';
      tdFormat.title = labelForCode(meta.formats, work.format_code);
      tr.appendChild(tdFormat);

      const tdTechnique = document.createElement('td');
      tdTechnique.className = 'works-code-ref-cell';
      tdTechnique.textContent = work.technique_code || '—';
      tdTechnique.title = labelForCode(meta.techniques, work.technique_code);
      tr.appendChild(tdTechnique);

      const tdSeries = document.createElement('td');
      tdSeries.className = 'works-series-cell';
      const seriesCodes = work.series_codes || [];
      tdSeries.textContent = seriesCodes.length ? seriesCodes.join(', ') : '—';
      tr.appendChild(tdSeries);

      const tdCollector = document.createElement('td');
      tdCollector.className = 'works-code-ref-cell';
      tdCollector.textContent = work.collector_code || '—';
      tdCollector.title = labelForCode(meta.collectors, work.collector_code);
      tr.appendChild(tdCollector);

      const tdPub = document.createElement('td');
      tdPub.className = 'works-status-cell';
      tdPub.textContent = work.publication_status_code || '—';
      tdPub.title = labelForCode(meta.publication_statuses, work.publication_status_code);
      tr.appendChild(tdPub);

      const tdPhoto = document.createElement('td');
      tdPhoto.className = 'works-status-cell';
      tdPhoto.textContent = work.photo_status_code || '—';
      tdPhoto.title = labelForCode(meta.photo_statuses, work.photo_status_code);
      tr.appendChild(tdPhoto);

      const tdAct = document.createElement('td');
      tdAct.className = 'editor-action-cell';
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'legend-editor-btn works-edit-row-btn';
      editBtn.textContent = 'Éditer';
      editBtn.addEventListener('click', () => openEditDialog(work.id));
      tdAct.appendChild(editBtn);
      tr.appendChild(tdAct);

      tbody.appendChild(tr);
    }
  }

  function populateEditSelects() {
    fillCodeSelect(editFormatSel, meta.formats, 'Aucun format', true, true);
    fillCodeSelect(editTechniqueSel, meta.techniques, 'Aucune technique', true, true);
    fillCodeSelect(editCollectorSel, meta.collectors, 'Aucun collectionneur', true, true);
    fillCodeSelect(editPublicationSel, meta.publication_statuses, '', false, false);
    fillCodeSelect(editPhotoSel, meta.photo_statuses, '', false, false);
  }

  function applyFormatDimensions(formatCode) {
    const fmt = formatByCode(formatCode);
    if (!fmt) return;
    if (editWidthInput && fmt.width_cm != null) {
      editWidthInput.value = String(fmt.width_cm);
    }
    if (editHeightInput && fmt.height_cm != null) {
      editHeightInput.value = String(fmt.height_cm);
    }
  }

  function closeEditDialog() {
    activeEditId = null;
    if (editBackdrop) editBackdrop.hidden = true;
    if (editDialog && editDialog.open) editDialog.close();
    if (editErrorEl) {
      editErrorEl.hidden = true;
      editErrorEl.textContent = '';
    }
    if (editSeriesPanel) editSeriesPanel.hidden = true;
  }

  function openEditDialog(workId) {
    const work = worksList.find((w) => w.id === workId);
    if (!work || !editDialog) return;
    activeEditId = workId;

    populateEditSelects();

    const url = thumbUrlForWorkId(work.id);
    if (editImage) {
      if (url) {
        editImage.src = url;
        editImage.hidden = false;
        editImage.onerror = function () {
          const full = workMediaById && workMediaById.get(work.id);
          if (full) {
            editImage.onerror = null;
            editImage.src = MEDIA_BASE + encodeMediaPath(full);
          }
        };
      } else {
        editImage.removeAttribute('src');
        editImage.hidden = true;
      }
    }

    if (editIdEl) {
      const fn = work.filename_original || '';
      editIdEl.textContent = fn ? `${work.id} — ${fn}` : work.id;
    }
    if (editTitleInput) editTitleInput.value = work.title || '';
    if (editYearInput) editYearInput.value = work.year != null ? String(work.year) : '';
    if (editFormatSel) editFormatSel.value = work.format_code || '';
    if (editWidthInput) {
      editWidthInput.value = work.width_cm != null ? String(work.width_cm) : '';
    }
    if (editHeightInput) {
      editHeightInput.value = work.height_cm != null ? String(work.height_cm) : '';
    }
    if (editTechniqueSel) editTechniqueSel.value = work.technique_code || '';
    if (editCollectorSel) editCollectorSel.value = work.collector_code || '';
    if (editPublicationSel) {
      editPublicationSel.value = work.publication_status_code || 'N';
    }
    if (editPhotoSel) editPhotoSel.value = work.photo_status_code || 'OK';

    renderSeriesPanel(work.series_codes || []);
    if (editSeriesPanel) editSeriesPanel.hidden = true;
    updateSeriesToggleText();

    if (editBackdrop) editBackdrop.hidden = false;
    if (typeof editDialog.showModal === 'function') editDialog.showModal();
  }

  function validateYear(v) {
    const t = String(v || '').trim();
    if (!t) return null;
    if (!/^\d{4}$/.test(t)) return undefined;
    return parseInt(t, 10);
  }

  function parseCmInput(v) {
    const t = String(v || '').trim().replace(',', '.');
    if (!t) return null;
    const n = parseFloat(t);
    if (Number.isNaN(n) || n <= 0) return undefined;
    return Math.round(n * 100) / 100;
  }

  function applyEditFromDialog() {
    if (!activeEditId) return;
    const work = worksList.find((w) => w.id === activeEditId);
    if (!work) return;

    const year = validateYear(editYearInput && editYearInput.value);
    if (year === undefined) {
      if (editErrorEl) {
        editErrorEl.hidden = false;
        editErrorEl.textContent = 'Année invalide : saisir 4 chiffres (ex. 1987) ou laisser vide.';
      }
      return;
    }

    const width = parseCmInput(editWidthInput && editWidthInput.value);
    const height = parseCmInput(editHeightInput && editHeightInput.value);
    if (width === undefined || height === undefined) {
      if (editErrorEl) {
        editErrorEl.hidden = false;
        editErrorEl.textContent = 'Dimensions invalides : nombres positifs ou champs vides.';
      }
      return;
    }

    if (editErrorEl) {
      editErrorEl.hidden = true;
      editErrorEl.textContent = '';
    }

    work.title = editTitleInput ? editTitleInput.value.trim() : work.title;
    work.year = year;
    work.format_code = editFormatSel
      ? (() => {
          const v = String(editFormatSel.value || '').trim().toUpperCase();
          return v && v !== NEW_OPTION_VALUE ? v : null;
        })()
      : work.format_code;
    work.technique_code = editTechniqueSel
      ? (() => {
          const v = String(editTechniqueSel.value || '').trim().toUpperCase();
          return v && v !== NEW_OPTION_VALUE ? v : null;
        })()
      : work.technique_code;
    work.collector_code = editCollectorSel
      ? (() => {
          const v = String(editCollectorSel.value || '').trim().toUpperCase();
          return v && v !== NEW_OPTION_VALUE ? v : null;
        })()
      : work.collector_code;
    work.publication_status_code = editPublicationSel
      ? String(editPublicationSel.value || 'N').trim().toUpperCase()
      : work.publication_status_code;
    work.photo_status_code = editPhotoSel
      ? String(editPhotoSel.value || 'OK').trim().toUpperCase()
      : work.photo_status_code;
    work.width_cm = width;
    work.height_cm = height;
    work.series_codes = readSelectedSeriesCodes();

    markDirty(work.id);
    closeEditDialog();
    renderTable();
    setStatus(`Modifications locales sur ${work.id} — pensez à enregistrer.`);
  }

  async function loadMeta() {
    const r = await apiFetch('/api/works/meta?token=' + encodeURIComponent(token));
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.error || 'meta failed');
    meta = j.meta || meta;
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
        publication_status_code: w.publication_status_code,
        photo_status_code: w.photo_status_code,
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
      if (pass !== EDIT_PASS) {
        loginErr.hidden = false;
        loginErr.textContent = 'Mot de passe incorrect.';
        return;
      }
      loginErr.hidden = true;
      token = pass;
      sessionStorage.setItem(AUTH_KEY, '1');
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

    filterEl.addEventListener('input', () => {
      filterText = filterEl.value;
      currentPage = 0;
      renderTable();
    });

    pagePrevBtn.addEventListener('click', () => {
      if (currentPage > 0) {
        currentPage -= 1;
        renderTable();
      }
    });

    pageNextBtn.addEventListener('click', () => {
      const pages = pageCount(filteredWorks());
      if (currentPage < pages - 1) {
        currentPage += 1;
        renderTable();
      }
    });

    editCloseBtn.addEventListener('click', closeEditDialog);
    editBackdrop.addEventListener('click', closeEditDialog);

    editForm.addEventListener('submit', (e) => {
      e.preventDefault();
      applyEditFromDialog();
    });

    editSeriesToggle.addEventListener('click', () => {
      if (!editSeriesPanel) return;
      editSeriesPanel.hidden = !editSeriesPanel.hidden;
    });

    editSeriesPanel.addEventListener('change', () => {
      updateSeriesToggleText();
      renderSeriesAddSelect(readSelectedSeriesCodes());
    });

    if (editSeriesAddSel) {
      editSeriesAddSel.addEventListener('change', async () => {
        const value = editSeriesAddSel.value;
        editSeriesAddSel.value = '';
        if (!value) return;
        if (value === NEW_OPTION_VALUE) {
          try {
            const code = await createSeriesFromPrompt();
            if (code) {
              renderSeriesPanel(readSelectedSeriesCodes());
              checkSeriesCode(code);
              if (editErrorEl) {
                editErrorEl.hidden = true;
                editErrorEl.textContent = '';
              }
              setStatus('Série ' + code + ' créée.');
            }
          } catch (e) {
            if (editErrorEl) {
              editErrorEl.hidden = false;
              editErrorEl.textContent = String(e.message || e);
            }
          }
          return;
        }
        checkSeriesCode(value);
      });
    }

    bindSelectNewHandler(editFormatSel, 'format', () => {
      applyFormatDimensions(editFormatSel.value);
    });
    bindSelectNewHandler(editTechniqueSel, 'technique');
    bindSelectNewHandler(editCollectorSel, 'collector');
  }

  async function init() {
    bindEvents();
    await showApiHint();
    if (sessionStorage.getItem(AUTH_KEY) === '1') {
      token = EDIT_PASS;
      await enterApp();
    }
  }

  init();
})();
