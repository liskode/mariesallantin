/**
 * Éditeur ressources site public — API locale ou Edge Function Supabase.
 */
(function () {
  const PRODUCTION_API =
    'https://leezsypadtvypdgqgvtk.supabase.co/functions/v1/resources-api';

  let siteConfig = null;
  let resolvedApiBase = '';
  /** @type {Array<object>} */
  let itemsList = [];
  /** @type {Array<object>} */
  let mediaTypes = [];
  /** @type {Array<object>} */
  let publicationStatuses = [];
  const dirtyIds = new Set();
  let token = '';

  const loginEl = document.getElementById('resources-login');
  const appEl = document.getElementById('resources-app');
  const passEl = document.getElementById('resources-pass');
  const loginBtn = document.getElementById('resources-login-btn');
  const loginErr = document.getElementById('resources-login-error');
  const apiHint = document.getElementById('resources-api-hint');
  const tbody = document.getElementById('resources-tbody');
  const countEl = document.getElementById('resources-count');
  const statusEl = document.getElementById('resources-status');
  const saveBtn = document.getElementById('resources-save-btn');
  const reloadBtn = document.getElementById('resources-reload-btn');
  const addBtn = document.getElementById('resources-add-btn');

  async function loadSiteConfig() {
    if (siteConfig) return siteConfig;
    siteConfig = {};
    try {
      const r = await fetch('media/collectors-config.json', { cache: 'no-store' });
      if (r.ok) siteConfig = await r.json();
    } catch {
      /* optionnel */
    }
    return siteConfig;
  }

  function isLocalDevServer() {
    return window.location.port === '47836';
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
    const meta = document.querySelector('meta[name="resources-api"]');
    const metaUrl = meta && meta.getAttribute('content');
    if (metaUrl && !metaUrl.includes('127.0.0.1')) {
      resolvedApiBase = String(metaUrl).trim().replace(/\/$/, '');
      return resolvedApiBase;
    }
    const cfg = await loadSiteConfig();
    if (cfg.resourcesApiUrl) {
      resolvedApiBase = String(cfg.resourcesApiUrl).trim().replace(/\/$/, '');
      return resolvedApiBase;
    }
    if (isProductionHost()) {
      resolvedApiBase = PRODUCTION_API;
      return resolvedApiBase;
    }
    resolvedApiBase = 'http://127.0.0.1:47836';
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

  function setStatus(msg, isError) {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.style.color = isError ? '#b00020' : '';
  }

  function updateSaveBtn() {
    EditorCommon.updateSaveButton(saveBtn, dirtyIds.size > 0);
  }

  function markDirty(id) {
    dirtyIds.add(id);
    updateSaveBtn();
  }

  function displayDate(value) {
    if (!value) return '';
    const s = String(value);
    if (/^\d{4}-01-01$/.test(s)) return s.slice(0, 4);
    return s;
  }

  function parseSeriesCodes(raw) {
    return String(raw || '')
      .split(/[,;\s]+/)
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean);
  }

  function destinationValue(row) {
    return String(row.url || row.internal_path || '').trim();
  }

  function bindDestinationInput(input, row, tr) {
    input.addEventListener('input', () => {
      const value = String(input.value || '').trim();
      if (!value) {
        row.url = '';
        row.internal_path = '';
      } else if (/^https?:\/\//i.test(value)) {
        row.url = value;
        row.internal_path = '';
      } else {
        row.url = '';
        row.internal_path = value;
      }
      markDirty(row.id);
      tr.classList.add('legend-editor-row--dirty');
    });
  }

  function bindInput(input, row, field, tr) {
    input.addEventListener('input', () => {
      row[field] = input.value;
      markDirty(row.id);
      tr.classList.add('legend-editor-row--dirty');
    });
  }

  function bindSelect(select, row, field, tr) {
    select.addEventListener('change', () => {
      row[field] = select.value;
      markDirty(row.id);
      tr.classList.add('legend-editor-row--dirty');
    });
  }

  function renderRow(row) {
    const tr = document.createElement('tr');
    if (dirtyIds.has(row.id)) tr.classList.add('legend-editor-row--dirty');

    const tdDelete = document.createElement('td');
    tdDelete.className = 'editor-action-cell';
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'editor-delete-btn';
    deleteBtn.title = 'Supprimer cette ressource';
    deleteBtn.setAttribute('aria-label', 'Supprimer ' + (row.title || row.id));
    deleteBtn.innerHTML = EditorCommon.TRASH_ICON;
    deleteBtn.addEventListener('click', () => deleteItem(row));
    tdDelete.appendChild(deleteBtn);
    tr.appendChild(tdDelete);

    const tdType = document.createElement('td');
    const typeSel = document.createElement('select');
    typeSel.className = 'legend-select legend-select--compact resources-type-select';
    mediaTypes.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t.code;
      opt.textContent = t.label || t.code;
      if (row.media_type_code === t.code) opt.selected = true;
      typeSel.appendChild(opt);
    });
    bindSelect(typeSel, row, 'media_type_code', tr);
    tdType.appendChild(typeSel);
    tr.appendChild(tdType);

    const tdTitle = document.createElement('td');
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'legend-input resources-title-input';
    titleInput.value = row.title || '';
    bindInput(titleInput, row, 'title', tr);
    tdTitle.appendChild(titleInput);
    tr.appendChild(tdTitle);

    const tdSource = document.createElement('td');
    const sourceInput = document.createElement('input');
    sourceInput.type = 'text';
    sourceInput.className = 'legend-input resources-source-input';
    sourceInput.value = row.source || '';
    bindInput(sourceInput, row, 'source', tr);
    tdSource.appendChild(sourceInput);
    tr.appendChild(tdSource);

    const tdDate = document.createElement('td');
    const dateInput = document.createElement('input');
    dateInput.type = 'text';
    dateInput.className = 'legend-input resources-date-input';
    dateInput.placeholder = 'AAAA ou AAAA-MM-JJ';
    dateInput.value = displayDate(row.media_date);
    dateInput.addEventListener('input', () => {
      row.media_date = dateInput.value.trim() || null;
      markDirty(row.id);
      tr.classList.add('legend-editor-row--dirty');
    });
    tdDate.appendChild(dateInput);
    tr.appendChild(tdDate);

    const tdDestination = document.createElement('td');
    const destinationInput = document.createElement('input');
    destinationInput.type = 'text';
    destinationInput.className = 'legend-input resources-destination-input';
    destinationInput.placeholder = 'https://… ou fap.html';
    destinationInput.value = destinationValue(row);
    bindDestinationInput(destinationInput, row, tr);
    tdDestination.appendChild(destinationInput);
    tr.appendChild(tdDestination);

    const tdThumb = document.createElement('td');
    const thumbInput = document.createElement('input');
    thumbInput.type = 'text';
    thumbInput.className = 'legend-input resources-path-input';
    thumbInput.placeholder = 'images/…';
    thumbInput.value = row.thumbnail_path || '';
    bindInput(thumbInput, row, 'thumbnail_path', tr);
    tdThumb.appendChild(thumbInput);
    tr.appendChild(tdThumb);

    const tdFile = document.createElement('td');
    const fileInput = document.createElement('input');
    fileInput.type = 'text';
    fileInput.className = 'legend-input resources-path-input';
    fileInput.placeholder = 'ressources/…';
    fileInput.value = row.file_path || '';
    bindInput(fileInput, row, 'file_path', tr);
    tdFile.appendChild(fileInput);
    tr.appendChild(tdFile);

    const tdEssential = document.createElement('td');
    const essentialInput = document.createElement('input');
    essentialInput.type = 'checkbox';
    essentialInput.className = 'resources-essential-checkbox';
    essentialInput.checked = Boolean(row.is_essential);
    essentialInput.title = 'Afficher dans le filtre Essentiels du site';
    essentialInput.addEventListener('change', () => {
      row.is_essential = essentialInput.checked;
      markDirty(row.id);
      tr.classList.add('legend-editor-row--dirty');
    });
    tdEssential.appendChild(essentialInput);
    tr.appendChild(tdEssential);

    const tdStatus = document.createElement('td');
    const statusSel = document.createElement('select');
    statusSel.className = 'legend-select legend-select--compact';
    publicationStatuses.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s.code;
      opt.textContent = s.code + ' — ' + (s.label || s.code);
      if (row.publication_status_code === s.code) opt.selected = true;
      statusSel.appendChild(opt);
    });
    bindSelect(statusSel, row, 'publication_status_code', tr);
    tdStatus.appendChild(statusSel);
    tr.appendChild(tdStatus);

    const tdOrder = document.createElement('td');
    const orderInput = document.createElement('input');
    orderInput.type = 'number';
    orderInput.className = 'legend-input resources-order-input';
    orderInput.value = row.sort_order != null ? String(row.sort_order) : '0';
    orderInput.addEventListener('input', () => {
      row.sort_order = parseInt(orderInput.value, 10) || 0;
      markDirty(row.id);
      tr.classList.add('legend-editor-row--dirty');
    });
    tdOrder.appendChild(orderInput);
    tr.appendChild(tdOrder);

    const tdSeries = document.createElement('td');
    const seriesInput = document.createElement('input');
    seriesInput.type = 'text';
    seriesInput.className = 'legend-input resources-series-input';
    seriesInput.placeholder = 'ABSTR, ENCRE';
    seriesInput.value = (row.series_codes || []).join(', ');
    seriesInput.addEventListener('input', () => {
      row.series_codes = parseSeriesCodes(seriesInput.value);
      markDirty(row.id);
      tr.classList.add('legend-editor-row--dirty');
    });
    tdSeries.appendChild(seriesInput);
    tr.appendChild(tdSeries);

    const tdDesc = document.createElement('td');
    const descArea = document.createElement('textarea');
    descArea.className = 'resources-desc-textarea';
    descArea.rows = 2;
    descArea.value = row.description || '';
    descArea.addEventListener('input', () => {
      row.description = descArea.value;
      markDirty(row.id);
      tr.classList.add('legend-editor-row--dirty');
    });
    tdDesc.appendChild(descArea);
    tr.appendChild(tdDesc);

    return tr;
  }

  function renderTable() {
    if (!tbody) return;
    tbody.innerHTML = '';
    itemsList.forEach((row) => tbody.appendChild(renderRow(row)));
    if (countEl) {
      countEl.textContent =
        itemsList.length + ' ressource(s)' + (dirtyIds.size ? ' — ' + dirtyIds.size + ' modifiée(s)' : '');
    }
  }

  function applyPayload(data) {
    itemsList = data.items || [];
    mediaTypes = data.media_types || [];
    publicationStatuses = data.publication_statuses || [];
    dirtyIds.clear();
    updateSaveBtn();
    renderTable();
  }

  async function loadAll() {
    setStatus('Chargement…');
    const r = await apiFetch('/api/resources?token=' + encodeURIComponent(token));
    const data = await r.json();
    if (!r.ok || !data.ok) {
      throw new Error(data.error || 'Erreur ' + r.status);
    }
    applyPayload(data);
    setStatus('');
  }

  async function saveDirty() {
    if (!dirtyIds.size) return;
    const payload = itemsList.filter((row) => dirtyIds.has(row.id));
    setStatus('Enregistrement…');
    saveBtn.disabled = true;
    try {
      const r = await apiFetch('/api/resources/save', {
        method: 'POST',
        body: JSON.stringify({ token, items: payload }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || 'Erreur ' + r.status);
      applyPayload(data);
      setStatus('Enregistré.');
      setTimeout(() => setStatus(''), 2500);
    } catch (e) {
      setStatus(String(e.message || e), true);
      updateSaveBtn();
    }
  }

  async function deleteItem(row) {
    const label = row.title || row.id;
    if (!window.confirm('Supprimer « ' + label + ' » ?')) return;
    setStatus('Suppression…');
    try {
      const r = await apiFetch(
        '/api/resources/' + encodeURIComponent(row.id) + '?token=' + encodeURIComponent(token),
        { method: 'DELETE' }
      );
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || 'Erreur ' + r.status);
      applyPayload(data);
      setStatus('Ressource supprimée.');
      setTimeout(() => setStatus(''), 2500);
    } catch (e) {
      setStatus(String(e.message || e), true);
    }
  }

  async function createItem() {
    setStatus('Création…');
    try {
      const r = await apiFetch('/api/resources/create', {
        method: 'POST',
        body: JSON.stringify({ token }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || 'Erreur ' + r.status);
      applyPayload(data);
      setStatus('Nouvelle ressource ajoutée (statut N).');
      setTimeout(() => setStatus(''), 3000);
    } catch (e) {
      setStatus(String(e.message || e), true);
    }
  }

  function showApp() {
    if (loginEl) loginEl.hidden = true;
    if (appEl) appEl.hidden = false;
  }

  function showLogin(errMsg) {
    if (loginEl) loginEl.hidden = false;
    if (appEl) appEl.hidden = true;
    if (loginErr) {
      if (errMsg) {
        loginErr.textContent = errMsg;
        loginErr.hidden = false;
      } else {
        loginErr.hidden = true;
        loginErr.textContent = '';
      }
    }
  }

  async function tryOpenSession(pass) {
    token = String(pass || '').trim();
    if (!EditorCommon.validatePassword(token)) {
      showLogin('Mot de passe incorrect.');
      return;
    }
    try {
      await loadAll();
      EditorCommon.setSessionToken(token);
      showApp();
    } catch (e) {
      showLogin(String(e.message || e));
    }
  }

  async function initApiHint() {
    if (!apiHint) return;
    const base = await apiBase();
    apiHint.textContent = isOnlineApi(base)
      ? 'API en ligne : ' + base
      : 'API locale : ' + base;
  }

  if (loginBtn) {
    loginBtn.addEventListener('click', () => tryOpenSession(passEl && passEl.value));
  }
  if (passEl) {
    passEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') tryOpenSession(passEl.value);
    });
  }
  if (saveBtn) saveBtn.addEventListener('click', () => saveDirty());
  if (reloadBtn) {
    reloadBtn.addEventListener('click', () => {
      if (dirtyIds.size && !window.confirm('Recharger sans enregistrer les modifications ?')) return;
      loadAll().catch((e) => setStatus(String(e.message || e), true));
    });
  }
  if (addBtn) addBtn.addEventListener('click', () => createItem());

  initApiHint();
  const saved = EditorCommon.getSessionToken();
  if (saved) {
    if (passEl) passEl.value = saved;
    tryOpenSession(saved);
  }
})();
