/**
 * Éditeur parcours artistique — API locale ou Edge Function Supabase.
 */
(function () {
  const PRODUCTION_API =
    'https://leezsypadtvypdgqgvtk.supabase.co/functions/v1/events-api';

  let siteConfig = null;
  let resolvedApiBase = '';
  /** @type {Array<object>} */
  let itemsList = [];
  /** @type {Array<object>} */
  let eventTypes = [];
  /** @type {Array<object>} */
  let eventRoles = [];
  /** @type {Array<object>} */
  let publicationStatuses = [];
  const dirtyIds = new Set();
  let token = '';

  const loginEl = document.getElementById('events-login');
  const appEl = document.getElementById('events-app');
  const passEl = document.getElementById('events-pass');
  const loginBtn = document.getElementById('events-login-btn');
  const loginErr = document.getElementById('events-login-error');
  const apiHint = document.getElementById('events-api-hint');
  const tbody = document.getElementById('events-tbody');
  const countEl = document.getElementById('events-count');
  const statusEl = document.getElementById('events-status');
  const saveBtn = document.getElementById('events-save-btn');
  const reloadBtn = document.getElementById('events-reload-btn');
  const addBtn = document.getElementById('events-add-btn');

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
    return window.location.port === '47837';
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
    const meta = document.querySelector('meta[name="events-api"]');
    const metaUrl = meta && meta.getAttribute('content');
    if (metaUrl && !metaUrl.includes('127.0.0.1')) {
      resolvedApiBase = String(metaUrl).trim().replace(/\/$/, '');
      return resolvedApiBase;
    }
    const cfg = await loadSiteConfig();
    if (cfg.eventsApiUrl) {
      resolvedApiBase = String(cfg.eventsApiUrl).trim().replace(/\/$/, '');
      return resolvedApiBase;
    }
    if (isProductionHost()) {
      resolvedApiBase = PRODUCTION_API;
      return resolvedApiBase;
    }
    resolvedApiBase = 'http://127.0.0.1:47837';
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

  function parseMediaIds(raw) {
    return String(raw || '')
      .split(/[,;\s]+/)
      .map((id) => id.trim())
      .filter(Boolean);
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

    const tdType = document.createElement('td');
    const typeSel = document.createElement('select');
    typeSel.className = 'legend-select legend-select--compact';
    eventTypes.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t.code;
      opt.textContent = t.label || t.code;
      if (row.event_type_code === t.code) opt.selected = true;
      typeSel.appendChild(opt);
    });
    bindSelect(typeSel, row, 'event_type_code', tr);
    tdType.appendChild(typeSel);
    tr.appendChild(tdType);

    const tdRole = document.createElement('td');
    const roleSel = document.createElement('select');
    roleSel.className = 'legend-select legend-select--compact';
    eventRoles.forEach((r) => {
      const opt = document.createElement('option');
      opt.value = r.code;
      opt.textContent = r.label || r.code;
      if (row.role_code === r.code) opt.selected = true;
      roleSel.appendChild(opt);
    });
    bindSelect(roleSel, row, 'role_code', tr);
    tdRole.appendChild(roleSel);
    tr.appendChild(tdRole);

    const tdDateLabel = document.createElement('td');
    const dateLabelInput = document.createElement('input');
    dateLabelInput.type = 'text';
    dateLabelInput.className = 'legend-input events-date-label-input';
    dateLabelInput.placeholder = '2017 ou 1988–1989';
    dateLabelInput.value = row.date_label || '';
    bindInput(dateLabelInput, row, 'date_label', tr);
    tdDateLabel.appendChild(dateLabelInput);
    tr.appendChild(tdDateLabel);

    const tdSortDate = document.createElement('td');
    const sortDateInput = document.createElement('input');
    sortDateInput.type = 'text';
    sortDateInput.className = 'legend-input events-date-input';
    sortDateInput.placeholder = 'AAAA ou AAAA-MM-JJ';
    sortDateInput.value = displayDate(row.sort_date);
    sortDateInput.addEventListener('input', () => {
      row.sort_date = sortDateInput.value.trim() || null;
      markDirty(row.id);
      tr.classList.add('legend-editor-row--dirty');
    });
    tdSortDate.appendChild(sortDateInput);
    tr.appendChild(tdSortDate);

    const tdSortDateEnd = document.createElement('td');
    const sortDateEndInput = document.createElement('input');
    sortDateEndInput.type = 'text';
    sortDateEndInput.className = 'legend-input events-date-input';
    sortDateEndInput.placeholder = 'AAAA ou AAAA-MM-JJ';
    sortDateEndInput.value = displayDate(row.sort_date_end);
    sortDateEndInput.addEventListener('input', () => {
      row.sort_date_end = sortDateEndInput.value.trim() || null;
      markDirty(row.id);
      tr.classList.add('legend-editor-row--dirty');
    });
    tdSortDateEnd.appendChild(sortDateEndInput);
    tr.appendChild(tdSortDateEnd);

    const tdLabel = document.createElement('td');
    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.className = 'legend-input events-label-input';
    labelInput.value = row.label || '';
    bindInput(labelInput, row, 'label', tr);
    tdLabel.appendChild(labelInput);
    tr.appendChild(tdLabel);

    const tdNote = document.createElement('td');
    const noteArea = document.createElement('textarea');
    noteArea.className = 'events-note-textarea';
    noteArea.rows = 2;
    noteArea.value = row.note || '';
    noteArea.addEventListener('input', () => {
      row.note = noteArea.value;
      markDirty(row.id);
      tr.classList.add('legend-editor-row--dirty');
    });
    tdNote.appendChild(noteArea);
    tr.appendChild(tdNote);

    const tdMedia = document.createElement('td');
    const mediaInput = document.createElement('input');
    mediaInput.type = 'text';
    mediaInput.className = 'legend-input events-media-input';
    mediaInput.placeholder = 'uuid1, uuid2';
    mediaInput.value = (row.media_ids || []).join(', ');
    mediaInput.addEventListener('input', () => {
      row.media_ids = parseMediaIds(mediaInput.value);
      markDirty(row.id);
      tr.classList.add('legend-editor-row--dirty');
    });
    tdMedia.appendChild(mediaInput);
    tr.appendChild(tdMedia);

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
    orderInput.className = 'legend-input events-order-input';
    orderInput.value = row.sort_order != null ? String(row.sort_order) : '0';
    orderInput.addEventListener('input', () => {
      row.sort_order = parseInt(orderInput.value, 10) || 0;
      markDirty(row.id);
      tr.classList.add('legend-editor-row--dirty');
    });
    tdOrder.appendChild(orderInput);
    tr.appendChild(tdOrder);

    EditorCommon.appendDeleteCell(tr, 0, {
      title: 'Supprimer cet événement',
      ariaLabel: 'Supprimer ' + (row.label || row.id),
      onDelete: () => deleteItem(row),
    });

    return tr;
  }

  function renderTable() {
    if (!tbody) return;
    tbody.innerHTML = '';
    itemsList.forEach((row) => tbody.appendChild(renderRow(row)));
    if (countEl) {
      countEl.textContent =
        itemsList.length + ' événement(s)' + (dirtyIds.size ? ' — ' + dirtyIds.size + ' modifié(s)' : '');
    }
  }

  function applyPayload(data) {
    itemsList = data.items || [];
    eventTypes = data.event_types || [];
    eventRoles = data.event_roles || [];
    publicationStatuses = data.publication_statuses || [];
    dirtyIds.clear();
    updateSaveBtn();
    renderTable();
  }

  async function loadAll() {
    setStatus('Chargement…');
    const r = await apiFetch('/api/events?token=' + encodeURIComponent(token));
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
      const r = await apiFetch('/api/events/save', {
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
    const label = row.label || row.id;
    if (!window.confirm('Supprimer « ' + label + ' » ?')) return;
    setStatus('Suppression…');
    try {
      const r = await apiFetch(
        '/api/events/' + encodeURIComponent(row.id) + '?token=' + encodeURIComponent(token),
        { method: 'DELETE' }
      );
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || 'Erreur ' + r.status);
      applyPayload(data);
      setStatus('Événement supprimé.');
      setTimeout(() => setStatus(''), 2500);
    } catch (e) {
      setStatus(String(e.message || e), true);
    }
  }

  async function createItem() {
    setStatus('Création…');
    try {
      const r = await apiFetch('/api/events/create', {
        method: 'POST',
        body: JSON.stringify({ token }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || 'Erreur ' + r.status);
      applyPayload(data);
      setStatus('Nouvel événement ajouté (statut N).');
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
