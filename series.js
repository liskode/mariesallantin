/**
 * Éditeur séries — API locale (dev) ou Edge Function Supabase (en ligne).
 */
(function () {
  const EDIT_PASS = 'MS75';
  const AUTH_KEY = 'series_edit_ok';
  const MEDIA_BASE = 'media/';
  const PRODUCTION_API =
    'https://leezsypadtvypdgqgvtk.supabase.co/functions/v1/series-api';
  const RASTER_EXT = new Set([
    '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.avif',
  ]);

  let siteConfig = null;
  let resolvedApiBase = '';
  /** @type {Map<string, string> | null} */
  let workMediaById = null;
  /** @type {Map<string, object[]>} */
  let worksBySeries = new Map();
  /** @type {Array<object>} */
  let seriesList = [];
  const dirtyCodes = new Set();
  let token = '';
  /** @type {{ series: object, iconImg: HTMLImageElement, tr: HTMLTableRowElement } | null} */
  let vignettePickerCtx = null;

  const loginEl = document.getElementById('series-login');
  const appEl = document.getElementById('series-app');
  const passEl = document.getElementById('series-pass');
  const loginBtn = document.getElementById('series-login-btn');
  const loginErr = document.getElementById('series-login-error');
  const apiHint = document.getElementById('series-api-hint');
  const tbody = document.getElementById('series-tbody');
  const countEl = document.getElementById('series-count');
  const statusEl = document.getElementById('series-status');
  const saveBtn = document.getElementById('series-save-btn');
  const reloadBtn = document.getElementById('series-reload-btn');
  const addBtn = document.getElementById('series-add-btn');
  const vignetteDialog = document.getElementById('series-vignette-dialog');
  const vignetteDialogTitle = document.getElementById('series-vignette-dialog-title');
  const vignetteDialogHint = document.getElementById('series-vignette-dialog-hint');
  const vignetteMosaic = document.getElementById('series-vignette-mosaic');
  const vignetteDialogClose = document.getElementById('series-vignette-dialog-close');

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
    return window.location.port === '47833';
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
    const meta = document.querySelector('meta[name="series-api"]');
    const metaUrl = meta && meta.getAttribute('content');
    if (metaUrl && !metaUrl.includes('127.0.0.1')) {
      resolvedApiBase = String(metaUrl).trim().replace(/\/$/, '');
      return resolvedApiBase;
    }
    const cfg = await loadSiteConfig();
    if (cfg.seriesApiUrl) {
      resolvedApiBase = String(cfg.seriesApiUrl).trim().replace(/\/$/, '');
      return resolvedApiBase;
    }
    if (isProductionHost()) {
      resolvedApiBase = PRODUCTION_API;
      return resolvedApiBase;
    }
    resolvedApiBase = 'http://127.0.0.1:47833';
    return resolvedApiBase;
  }

  function isOnlineApi(base) {
    return base.includes('supabase.co');
  }

  async function supabaseAnonKey() {
    const meta = document.querySelector('meta[name="supabase-anon-key"]');
    const fromMeta = meta ? String(meta.getAttribute('content') || '').trim() : '';
    if (fromMeta) return fromMeta;
    const cfg = await loadSiteConfig();
    return cfg.anonKey ? String(cfg.anonKey).trim() : '';
  }

  async function apiFetch(pathAndQuery, init) {
    const base = await apiBase();
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
    return fetch(base + pathAndQuery, { ...init, headers });
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

  function thumbUrlForWork(work) {
    if (!work) return '';
    const media = typeof work === 'string' ? workMediaById && workMediaById.get(work) : work.media;
    const workId = typeof work === 'string' ? work : work.id;
    if (!media && workId && workMediaById) {
      const m = workMediaById.get(workId);
      if (m) return thumbUrlForMedia(m);
    }
    return media ? thumbUrlForMedia(String(media)) : '';
  }

  function thumbUrlForMedia(media) {
    const thumbRel = webThumbRelFromMediaFp(media);
    return thumbRel
      ? MEDIA_BASE + encodeMediaPath(thumbRel)
      : MEDIA_BASE + encodeMediaPath(media);
  }

  function thumbUrlForWorkId(workId) {
    if (!workId) return '';
    if (workMediaById && workMediaById.has(workId)) {
      return thumbUrlForMedia(workMediaById.get(workId));
    }
    return '';
  }

  async function loadWorksCatalog() {
    if (workMediaById) return;
    workMediaById = new Map();
    worksBySeries = new Map();
    try {
      const r = await fetch(MEDIA_BASE + 'works.json');
      if (r.ok) {
        const j = await r.json();
        for (const w of j.works || []) {
          if (w.id && w.media) workMediaById.set(w.id, String(w.media));
          for (const code of w.series || []) {
            if (!worksBySeries.has(code)) worksBySeries.set(code, []);
            worksBySeries.get(code).push(w);
          }
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
    const dirty = dirtyCodes.size > 0;
    saveBtn.disabled = !dirty;
    saveBtn.classList.toggle('legend-editor-btn--save-dirty', dirty);
    saveBtn.classList.toggle('legend-editor-btn--save-clean', !dirty);
  }

  function markDirty(code) {
    dirtyCodes.add(code);
    updateSaveBtn();
  }

  function thumbPlaceholderFromImg(imgEl) {
    const btn = imgEl && imgEl.parentElement;
    return btn ? btn.querySelector('.series-icon-placeholder') : null;
  }

  function updateIconPreview(imgEl, workId) {
    if (!imgEl) return;
    const url = thumbUrlForWorkId(workId);
    if (url) {
      imgEl.src = url;
      imgEl.hidden = false;
      imgEl.onerror = function () {
        const full = workMediaById && workId && workMediaById.get(workId);
        if (full) {
          imgEl.onerror = null;
          imgEl.src = MEDIA_BASE + encodeMediaPath(full);
        }
      };
    } else {
      imgEl.removeAttribute('src');
      imgEl.hidden = true;
    }
  }

  function parseYearInput(raw) {
    const v = String(raw || '').replace(/\D/g, '').slice(0, 4);
    if (!v) return { display: '', value: null };
    const n = parseInt(v, 10);
    if (v.length === 4 && n >= 1000 && n <= 9999) return { display: v, value: n };
    return { display: v, value: null };
  }

  function bindYearInput(input, seriesObj, field, tr) {
    input.type = 'text';
    input.inputMode = 'numeric';
    input.maxLength = 4;
    input.className = 'legend-input series-year-input';
    input.placeholder = '····';
    input.value = seriesObj[field] != null ? String(seriesObj[field]) : '';
    input.addEventListener('input', () => {
      const digits = input.value.replace(/\D/g, '').slice(0, 4);
      input.value = digits;
      const parsed = parseYearInput(digits);
      seriesObj[field] = parsed.value;
      markDirty(seriesObj.code);
      tr.classList.add('legend-editor-row--dirty');
    });
  }

  function closeVignetteDialog() {
    vignettePickerCtx = null;
    if (vignetteDialog && vignetteDialog.open) vignetteDialog.close();
  }

  function openVignettePicker(seriesObj, iconImg, tr) {
    if (!vignetteDialog || !vignetteMosaic) return;
    vignettePickerCtx = { series: seriesObj, iconImg, tr };
    const works = worksBySeries.get(seriesObj.code) || [];
    const label = seriesObj.label || seriesObj.code;

    if (vignetteDialogTitle) {
      vignetteDialogTitle.textContent = 'Vignette — ' + label;
    }
    if (vignetteDialogHint) {
      vignetteDialogHint.textContent = works.length
        ? works.length + ' œuvre(s) dans cette série. Cliquez pour choisir.'
        : 'Aucune œuvre liée à cette série dans works.json.';
    }

    vignetteMosaic.innerHTML = '';
    if (!works.length) {
      const empty = document.createElement('p');
      empty.className = 'series-vignette-mosaic-empty';
      empty.textContent = 'Aucune vignette disponible.';
      vignetteMosaic.appendChild(empty);
    } else {
      for (const w of works) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'series-vignette-mosaic-item';
        if (seriesObj.icon_work_id === w.id) {
          btn.classList.add('series-vignette-mosaic-item--selected');
        }
        btn.title = w.id + (w.title ? ' — ' + w.title : '');

        const img = document.createElement('img');
        img.className = 'series-vignette-mosaic-thumb';
        img.alt = '';
        img.width = 72;
        img.height = 72;
        const url = thumbUrlForWork(w);
        if (url) {
          img.src = url;
          img.onerror = function () {
            if (w.media) {
              img.onerror = null;
              img.src = MEDIA_BASE + encodeMediaPath(w.media);
            }
          };
        }

        const idEl = document.createElement('span');
        idEl.className = 'series-vignette-mosaic-id';
        idEl.textContent = w.id;

        btn.appendChild(img);
        btn.appendChild(idEl);
        btn.addEventListener('click', () => {
          seriesObj.icon_work_id = w.id;
          updateIconPreview(iconImg, w.id);
          const ph = thumbPlaceholderFromImg(iconImg);
          if (ph) ph.hidden = true;
          markDirty(seriesObj.code);
          tr.classList.add('legend-editor-row--dirty');
          closeVignetteDialog();
        });
        vignetteMosaic.appendChild(btn);
      }
    }

    if (typeof vignetteDialog.showModal === 'function') {
      vignetteDialog.showModal();
    } else {
      vignetteDialog.setAttribute('open', '');
    }
  }

  function renderTable() {
    if (!tbody) return;
    tbody.innerHTML = '';

    for (const s of seriesList) {
      const tr = document.createElement('tr');
      if (dirtyCodes.has(s.code)) tr.classList.add('legend-editor-row--dirty');

      const tdCode = document.createElement('td');
      tdCode.textContent = s.code;
      tdCode.className = 'series-code-cell';

      const tdLabel = document.createElement('td');
      const labelInput = document.createElement('input');
      labelInput.type = 'text';
      labelInput.className = 'legend-input series-label-input';
      labelInput.value = s.label || '';
      labelInput.addEventListener('input', () => {
        s.label = labelInput.value;
        markDirty(s.code);
        tr.classList.add('legend-editor-row--dirty');
      });
      tdLabel.appendChild(labelInput);

      const tdVignette = document.createElement('td');
      tdVignette.className = 'series-vignette-cell';

      const thumbBtn = document.createElement('button');
      thumbBtn.type = 'button';
      thumbBtn.className = 'series-vignette-btn';
      thumbBtn.title = 'Choisir une vignette dans la série';

      const iconImg = document.createElement('img');
      iconImg.className = 'series-icon-thumb';
      iconImg.alt = '';
      iconImg.width = 36;
      iconImg.height = 36;
      updateIconPreview(iconImg, s.icon_work_id);

      const placeholder = document.createElement('span');
      placeholder.className = 'series-icon-placeholder';
      placeholder.textContent = '＋';
      placeholder.hidden = !!s.icon_work_id;

      thumbBtn.appendChild(iconImg);
      thumbBtn.appendChild(placeholder);

      thumbBtn.addEventListener('click', () => {
        openVignettePicker(s, iconImg, tr);
      });

      tdVignette.appendChild(thumbBtn);

      const tdYears = document.createElement('td');
      tdYears.className = 'series-years-cell';
      const yearStart = document.createElement('input');
      const yearEnd = document.createElement('input');
      bindYearInput(yearStart, s, 'year_start', tr);
      bindYearInput(yearEnd, s, 'year_end', tr);
      const yearSep = document.createElement('span');
      yearSep.className = 'series-years-sep';
      yearSep.textContent = 'à';
      tdYears.appendChild(yearStart);
      tdYears.appendChild(yearSep);
      tdYears.appendChild(yearEnd);

      const tdDesc = document.createElement('td');
      const descArea = document.createElement('textarea');
      descArea.className = 'legend-input series-desc-textarea';
      descArea.rows = 2;
      descArea.title = 'Coller le texte ici';
      descArea.placeholder = 'Coller…';
      descArea.value = s.description || '';
      descArea.addEventListener('input', () => {
        s.description = descArea.value;
        markDirty(s.code);
        tr.classList.add('legend-editor-row--dirty');
      });
      tdDesc.appendChild(descArea);

      const tdCount = document.createElement('td');
      tdCount.textContent = String(s.work_count ?? 0);
      tdCount.className = 'series-count-cell';

      tr.appendChild(tdCode);
      tr.appendChild(tdLabel);
      tr.appendChild(tdVignette);
      tr.appendChild(tdYears);
      tr.appendChild(tdDesc);
      tr.appendChild(tdCount);
      tbody.appendChild(tr);
    }

    if (countEl) countEl.textContent = seriesList.length + ' série(s)';
  }

  async function loadSeries() {
    setStatus('Chargement…');
    await loadWorksCatalog();
    const r = await apiFetch('/api/series?token=' + encodeURIComponent(token));
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'chargement impossible');
    seriesList = j.series || [];
    dirtyCodes.clear();
    updateSaveBtn();
    renderTable();
    setStatus('');
  }

  async function saveDirty() {
    const toSave = seriesList.filter((s) => dirtyCodes.has(s.code));
    if (!toSave.length) {
      setStatus('Rien à enregistrer.');
      return;
    }
    saveBtn.disabled = true;
    setStatus('Enregistrement…');
    try {
      const r = await apiFetch('/api/series/save', {
        method: 'POST',
        body: JSON.stringify({ token, series: toSave }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'échec enregistrement');
      seriesList = j.series || seriesList;
      dirtyCodes.clear();
      renderTable();
      setStatus('Enregistré (' + toSave.length + ' fiche(s)).');
    } finally {
      updateSaveBtn();
    }
  }

  async function createSeries() {
    const code = window.prompt(
      'Code de la nouvelle série (2–12 caractères, ex. ABSTR) :'
    );
    if (!code) return;
    const normalized = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{2,12}$/.test(normalized)) {
      setStatus('Code invalide : 2–12 caractères A-Z ou chiffres.', true);
      return;
    }
    const label = window.prompt('Libellé de la série (optionnel) :') || '';
    setStatus('Création…');
    const r = await apiFetch('/api/series/create', {
      method: 'POST',
      body: JSON.stringify({ token, code: normalized, label: label.trim() }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'échec création');
    seriesList = j.series || seriesList;
    dirtyCodes.clear();
    updateSaveBtn();
    renderTable();
    setStatus('Série ' + normalized + ' créée.');
  }

  async function checkApiHealth() {
    try {
      const base = await apiBase();
      const r = await apiFetch('/api/health');
      const j = await r.json();
      if (apiHint) {
        apiHint.textContent = j.ok
          ? isOnlineApi(base)
            ? 'API en ligne (Supabase).'
            : 'API locale (' + base + ').'
          : 'API : réponse inattendue.';
      }
      return !!j.ok;
    } catch {
      if (apiHint) {
        apiHint.textContent = isProductionHost()
          ? 'API en ligne indisponible. Déployez series-api sur Supabase.'
          : 'API locale : npm run series:api';
      }
      return false;
    }
  }

  function showApp() {
    if (loginEl) loginEl.hidden = true;
    if (appEl) appEl.hidden = false;
  }

  async function tryLogin() {
    const pass = passEl ? passEl.value : '';
    if (pass !== EDIT_PASS) {
      if (loginErr) {
        loginErr.textContent = 'Mot de passe incorrect.';
        loginErr.hidden = false;
      }
      return;
    }
    token = pass;
    sessionStorage.setItem(AUTH_KEY, '1');
    if (!(await checkApiHealth())) {
      if (loginErr) {
        loginErr.textContent = isProductionHost()
          ? 'API en ligne indisponible.'
          : 'Lancez npm run series:api puis http://127.0.0.1:47833/';
        loginErr.hidden = false;
      }
      return;
    }
    if (loginErr) loginErr.hidden = true;
    showApp();
    try {
      await loadSeries();
    } catch (e) {
      setStatus(String(e.message || e), true);
    }
  }

  if (loginBtn) loginBtn.addEventListener('click', tryLogin);
  if (passEl) {
    passEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') tryLogin();
    });
  }
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      saveDirty().catch((e) => setStatus(String(e.message || e), true));
    });
  }
  if (reloadBtn) {
    reloadBtn.addEventListener('click', () => {
      loadSeries().catch((e) => setStatus(String(e.message || e), true));
    });
  }
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      createSeries().catch((e) => setStatus(String(e.message || e), true));
    });
  }
  if (vignetteDialogClose) {
    vignetteDialogClose.addEventListener('click', closeVignetteDialog);
  }
  if (vignetteDialog) {
    vignetteDialog.addEventListener('click', (e) => {
      if (e.target === vignetteDialog) closeVignetteDialog();
    });
    vignetteDialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      closeVignetteDialog();
    });
  }

  checkApiHealth();
  if (sessionStorage.getItem(AUTH_KEY) === '1' && passEl) {
    passEl.value = EDIT_PASS;
    tryLogin();
  }
})();
