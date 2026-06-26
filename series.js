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
  /** @type {Array<object>} */
  let seriesList = [];
  const dirtyCodes = new Set();
  let token = '';

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

  function thumbUrlForWorkId(workId) {
    if (!workMediaById || !workId) return '';
    const media = workMediaById.get(workId);
    if (!media) return '';
    const thumbRel = webThumbRelFromMediaFp(media);
    return thumbRel
      ? MEDIA_BASE + encodeMediaPath(thumbRel)
      : MEDIA_BASE + encodeMediaPath(media);
  }

  async function loadWorkMediaMap() {
    if (workMediaById) return workMediaById;
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
    return workMediaById;
  }

  function setStatus(msg, isError) {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.style.color = isError ? '#b00020' : '';
  }

  function markDirty(code) {
    dirtyCodes.add(code);
    if (saveBtn) saveBtn.disabled = dirtyCodes.size === 0;
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
      labelInput.className = 'legend-input';
      labelInput.value = s.label || '';
      labelInput.addEventListener('input', () => {
        s.label = labelInput.value;
        markDirty(s.code);
        tr.classList.add('legend-editor-row--dirty');
      });
      tdLabel.appendChild(labelInput);

      const tdIcon = document.createElement('td');
      tdIcon.className = 'series-icon-cell';
      const iconImg = document.createElement('img');
      iconImg.className = 'series-icon-thumb';
      iconImg.alt = '';
      iconImg.width = 56;
      iconImg.height = 56;
      updateIconPreview(iconImg, s.icon_work_id);
      tdIcon.appendChild(iconImg);

      const tdWorkId = document.createElement('td');
      const workInput = document.createElement('input');
      workInput.type = 'text';
      workInput.className = 'legend-input series-work-id-input';
      workInput.placeholder = 'MS0000';
      workInput.value = s.icon_work_id || '';
      workInput.addEventListener('input', () => {
        s.icon_work_id = workInput.value.trim().toUpperCase();
        updateIconPreview(iconImg, s.icon_work_id);
        markDirty(s.code);
        tr.classList.add('legend-editor-row--dirty');
      });
      tdWorkId.appendChild(workInput);

      function yearCell(field) {
        const td = document.createElement('td');
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '1000';
        input.max = '9999';
        input.step = '1';
        input.className = 'legend-input series-year-input';
        input.value = s[field] != null ? String(s[field]) : '';
        input.addEventListener('input', () => {
          const v = input.value.trim();
          s[field] = v ? parseInt(v, 10) : null;
          markDirty(s.code);
          tr.classList.add('legend-editor-row--dirty');
        });
        td.appendChild(input);
        return td;
      }

      const tdDesc = document.createElement('td');
      const descArea = document.createElement('textarea');
      descArea.className = 'legend-input series-desc-textarea';
      descArea.rows = 3;
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
      tr.appendChild(tdIcon);
      tr.appendChild(tdWorkId);
      tr.appendChild(yearCell('year_start'));
      tr.appendChild(yearCell('year_end'));
      tr.appendChild(tdDesc);
      tr.appendChild(tdCount);
      tbody.appendChild(tr);
    }

    if (countEl) countEl.textContent = seriesList.length + ' série(s)';
  }

  async function loadSeries() {
    setStatus('Chargement…');
    await loadWorkMediaMap();
    const r = await apiFetch('/api/series?token=' + encodeURIComponent(token));
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'chargement impossible');
    seriesList = j.series || [];
    dirtyCodes.clear();
    if (saveBtn) saveBtn.disabled = true;
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

  checkApiHealth();
  if (sessionStorage.getItem(AUTH_KEY) === '1' && passEl) {
    passEl.value = EDIT_PASS;
    tryLogin();
  }
})();
