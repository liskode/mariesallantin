/**
 * Éditeur formats & techniques — API locale ou Edge Function Supabase.
 */
(function () {
  const EDIT_PASS = 'MS75';
  const AUTH_KEY = 'codes_edit_ok';
  const PRODUCTION_API =
    'https://leezsypadtvypdgqgvtk.supabase.co/functions/v1/codes-api';

  function appendCountAndDelete(tr, row, kind) {
    const count = row.work_count ?? 0;
    const tdCount = document.createElement('td');
    tdCount.textContent = String(count);
    tdCount.className = 'codes-work-count-cell';
    tr.appendChild(tdCount);

    const EC = window.EditorCommon;
    if (EC) {
      EC.appendDeleteCell(tr, count, {
        code: row.code,
        onDelete: () => {
          if (kind === 'format') deleteFormat(row);
          else deleteTechnique(row);
        },
      });
      return;
    }
    const tdAct = document.createElement('td');
    tdAct.className = 'editor-action-cell';
    tr.appendChild(tdAct);
  }

  let siteConfig = null;
  let resolvedApiBase = '';
  /** @type {Array<object>} */
  let formatsList = [];
  /** @type {Array<object>} */
  let techniquesList = [];
  const dirtyFormats = new Set();
  const dirtyTechniques = new Set();
  let token = '';
  /** @type {{ kind: 'format' | 'technique', code: string } | null} */
  let focusAfterRender = null;

  const loginEl = document.getElementById('codes-login');
  const appEl = document.getElementById('codes-app');
  const passEl = document.getElementById('codes-pass');
  const loginBtn = document.getElementById('codes-login-btn');
  const loginErr = document.getElementById('codes-login-error');
  const apiHint = document.getElementById('codes-api-hint');
  const formatsTbody = document.getElementById('formats-tbody');
  const techniquesTbody = document.getElementById('techniques-tbody');
  const countEl = document.getElementById('codes-count');
  const statusEl = document.getElementById('codes-status');
  const saveBtn = document.getElementById('codes-save-btn');
  const reloadBtn = document.getElementById('codes-reload-btn');
  const formatsAddBtn = document.getElementById('formats-add-btn');
  const techniquesAddBtn = document.getElementById('techniques-add-btn');

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
    return window.location.port === '47834';
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
    const meta = document.querySelector('meta[name="codes-api"]');
    const metaUrl = meta && meta.getAttribute('content');
    if (metaUrl && !metaUrl.includes('127.0.0.1')) {
      resolvedApiBase = String(metaUrl).trim().replace(/\/$/, '');
      return resolvedApiBase;
    }
    const cfg = await loadSiteConfig();
    if (cfg.codesApiUrl) {
      resolvedApiBase = String(cfg.codesApiUrl).trim().replace(/\/$/, '');
      return resolvedApiBase;
    }
    if (isProductionHost()) {
      resolvedApiBase = PRODUCTION_API;
      return resolvedApiBase;
    }
    resolvedApiBase = 'http://127.0.0.1:47834';
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
    if (!saveBtn) return;
    const dirty = dirtyFormats.size > 0 || dirtyTechniques.size > 0;
    saveBtn.disabled = !dirty;
    saveBtn.classList.toggle('legend-editor-btn--save-dirty', dirty);
    saveBtn.classList.toggle('legend-editor-btn--save-clean', !dirty);
  }

  function markFormatDirty(code) {
    dirtyFormats.add(code);
    updateSaveBtn();
  }

  function markTechniqueDirty(code) {
    dirtyTechniques.add(code);
    updateSaveBtn();
  }

  function parseCmInput(raw) {
    const v = String(raw || '').trim().replace(',', '.');
    if (!v) return null;
    const n = parseFloat(v);
    if (Number.isNaN(n) || n <= 0) return null;
    return Math.round(n * 100) / 100;
  }

  function cmDisplay(v) {
    if (v == null || v === '') return '';
    return String(v);
  }

  function bindTextInput(input, row, field, kind, tr) {
    input.addEventListener('input', () => {
      row[field] = input.value;
      if (kind === 'format') {
        markFormatDirty(row.code);
      } else {
        markTechniqueDirty(row.code);
      }
      tr.classList.add('legend-editor-row--dirty');
    });
  }

  function bindCmInput(input, row, field, tr) {
    input.addEventListener('input', () => {
      row[field] = parseCmInput(input.value);
      markFormatDirty(row.code);
      tr.classList.add('legend-editor-row--dirty');
    });
  }

  function applyFocusAfterRender() {
    if (!focusAfterRender) return;
    const { kind, code } = focusAfterRender;
    focusAfterRender = null;
    const tbody = kind === 'format' ? formatsTbody : techniquesTbody;
    if (!tbody) return;
    const tr = tbody.querySelector(`tr[data-code="${code}"]`);
    if (!tr) return;
    tr.classList.add('codes-editor-row--focus');
    const labelInput = tr.querySelector('.codes-label-input');
    if (labelInput) {
      labelInput.focus();
      labelInput.select();
    }
    tr.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    window.setTimeout(() => tr.classList.remove('codes-editor-row--focus'), 2500);
  }

  function renderFormats() {
    if (!formatsTbody) return;
    formatsTbody.innerHTML = '';
    for (const f of formatsList) {
      const tr = document.createElement('tr');
      tr.dataset.code = f.code;
      if (dirtyFormats.has(f.code)) tr.classList.add('legend-editor-row--dirty');

      const tdCode = document.createElement('td');
      tdCode.textContent = f.code;
      tdCode.className = 'codes-code-cell';

      const tdLabel = document.createElement('td');
      const labelInput = document.createElement('input');
      labelInput.type = 'text';
      labelInput.className = 'legend-input codes-label-input';
      labelInput.value = f.label || '';
      bindTextInput(labelInput, f, 'label', 'format', tr);
      tdLabel.appendChild(labelInput);

      const tdW = document.createElement('td');
      const wInput = document.createElement('input');
      wInput.type = 'text';
      wInput.inputMode = 'decimal';
      wInput.className = 'legend-input codes-cm-input';
      wInput.value = cmDisplay(f.width_cm);
      bindCmInput(wInput, f, 'width_cm', tr);
      tdW.appendChild(wInput);

      const tdH = document.createElement('td');
      const hInput = document.createElement('input');
      hInput.type = 'text';
      hInput.inputMode = 'decimal';
      hInput.className = 'legend-input codes-cm-input';
      hInput.value = cmDisplay(f.height_cm);
      bindCmInput(hInput, f, 'height_cm', tr);
      tdH.appendChild(hInput);

      tr.appendChild(tdCode);
      tr.appendChild(tdLabel);
      tr.appendChild(tdW);
      tr.appendChild(tdH);
      appendCountAndDelete(tr, f, 'format');
      formatsTbody.appendChild(tr);
    }
  }

  function renderTechniques() {
    if (!techniquesTbody) return;
    techniquesTbody.innerHTML = '';
    for (const t of techniquesList) {
      const tr = document.createElement('tr');
      tr.dataset.code = t.code;
      if (dirtyTechniques.has(t.code)) tr.classList.add('legend-editor-row--dirty');

      const tdCode = document.createElement('td');
      tdCode.textContent = t.code;
      tdCode.className = 'codes-code-cell';

      const tdLabel = document.createElement('td');
      const labelInput = document.createElement('input');
      labelInput.type = 'text';
      labelInput.className = 'legend-input codes-label-input';
      labelInput.value = t.label || '';
      bindTextInput(labelInput, t, 'label', 'technique', tr);
      tdLabel.appendChild(labelInput);

      tr.appendChild(tdCode);
      tr.appendChild(tdLabel);
      appendCountAndDelete(tr, t, 'technique');
      techniquesTbody.appendChild(tr);
    }
  }

  function renderAll() {
    renderFormats();
    renderTechniques();
    if (countEl) {
      countEl.textContent =
        formatsList.length + ' format(s) · ' + techniquesList.length + ' technique(s)';
    }
    applyFocusAfterRender();
  }

  async function loadCodes() {
    setStatus('Chargement…');
    const r = await apiFetch('/api/codes?token=' + encodeURIComponent(token));
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'chargement impossible');
    formatsList = j.formats || [];
    techniquesList = j.techniques || [];
    dirtyFormats.clear();
    dirtyTechniques.clear();
    updateSaveBtn();
    renderAll();
    setStatus('');
  }

  async function saveDirty() {
    const formatsToSave = formatsList.filter((f) => dirtyFormats.has(f.code));
    const techniquesToSave = techniquesList.filter((t) => dirtyTechniques.has(t.code));
    if (!formatsToSave.length && !techniquesToSave.length) {
      setStatus('Rien à enregistrer.');
      return;
    }
    saveBtn.disabled = true;
    setStatus('Enregistrement…');
    try {
      const r = await apiFetch('/api/codes/save', {
        method: 'POST',
        body: JSON.stringify({
          token,
          formats: formatsToSave,
          techniques: techniquesToSave,
        }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'échec enregistrement');
      formatsList = j.formats || formatsList;
      techniquesList = j.techniques || techniquesList;
      dirtyFormats.clear();
      dirtyTechniques.clear();
      renderAll();
      const n = formatsToSave.length + techniquesToSave.length;
      setStatus('Enregistré (' + n + ' fiche(s)).');
    } finally {
      updateSaveBtn();
    }
  }

  async function createFormat() {
    const code = window.prompt('Code du nouveau format (4 caractères, ex. HF10) :');
    if (!code) return;
    const normalized = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(normalized)) {
      setStatus('Code invalide : 4 caractères A-Z ou chiffres.', true);
      return;
    }
    setStatus('Création…');
    const r = await apiFetch('/api/formats/create', {
      method: 'POST',
      body: JSON.stringify({ token, code: normalized }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'échec création');
    formatsList = j.formats || formatsList;
    techniquesList = j.techniques || techniquesList;
    focusAfterRender = { kind: 'format', code: j.createdCode || normalized };
    renderAll();
    setStatus('Format ' + normalized + ' créé — complétez le libellé et les dimensions.');
  }

  async function createTechnique() {
    const code = window.prompt('Code de la nouvelle technique (3 caractères, ex. GOU) :');
    if (!code) return;
    const normalized = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{3}$/.test(normalized)) {
      setStatus('Code invalide : 3 caractères A-Z ou chiffres.', true);
      return;
    }
    setStatus('Création…');
    const r = await apiFetch('/api/techniques/create', {
      method: 'POST',
      body: JSON.stringify({ token, code: normalized }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'échec création');
    formatsList = j.formats || formatsList;
    techniquesList = j.techniques || techniquesList;
    focusAfterRender = { kind: 'technique', code: j.createdCode || normalized };
    renderAll();
    setStatus('Technique ' + normalized + ' créée — complétez le libellé.');
  }

  async function deleteFormat(row) {
    if (!row.code) return;
    if (!window.confirm('Supprimer le format ' + row.code + ' ?')) return;
    setStatus('Suppression…');
    const r = await apiFetch(
      '/api/formats/' + encodeURIComponent(row.code) + '?token=' + encodeURIComponent(token),
      { method: 'DELETE' }
    );
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'suppression impossible');
    formatsList = j.formats || formatsList;
    techniquesList = j.techniques || techniquesList;
    dirtyFormats.delete(row.code);
    updateSaveBtn();
    renderAll();
    setStatus('Format ' + row.code + ' supprimé.');
  }

  async function deleteTechnique(row) {
    if (!row.code) return;
    if (!window.confirm('Supprimer la technique ' + row.code + ' ?')) return;
    setStatus('Suppression…');
    const r = await apiFetch(
      '/api/techniques/' + encodeURIComponent(row.code) + '?token=' + encodeURIComponent(token),
      { method: 'DELETE' }
    );
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'suppression impossible');
    formatsList = j.formats || formatsList;
    techniquesList = j.techniques || techniquesList;
    dirtyTechniques.delete(row.code);
    updateSaveBtn();
    renderAll();
    setStatus('Technique ' + row.code + ' supprimée.');
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
          ? 'API en ligne indisponible. Déployez codes-api sur Supabase.'
          : 'API locale : npm run codes:api';
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
          : 'Lancez npm run codes:api puis http://127.0.0.1:47834/';
        loginErr.hidden = false;
      }
      return;
    }
    if (loginErr) loginErr.hidden = true;
    showApp();
    try {
      await loadCodes();
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
      loadCodes().catch((e) => setStatus(String(e.message || e), true));
    });
  }
  if (formatsAddBtn) {
    formatsAddBtn.addEventListener('click', () => {
      createFormat().catch((e) => setStatus(String(e.message || e), true));
    });
  }
  if (techniquesAddBtn) {
    techniquesAddBtn.addEventListener('click', () => {
      createTechnique().catch((e) => setStatus(String(e.message || e), true));
    });
  }

  checkApiHealth();
  if (sessionStorage.getItem(AUTH_KEY) === '1' && passEl) {
    passEl.value = EDIT_PASS;
    tryLogin();
  }
})();
