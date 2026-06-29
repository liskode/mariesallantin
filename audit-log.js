/**
 * Journal des modifications éditeur (lecture admin).
 */
(function () {
  const AUTH = () => window.EditorCommon;
  const PRODUCTION_API =
    'https://leezsypadtvypdgqgvtk.supabase.co/functions/v1/audit-log-api';

  const ACTION_LABELS = { save: 'Enregistrement', delete: 'Suppression' };
  const ROLE_LABELS = { artist: 'Artiste', admin: 'Administrateur' };
  const ENTITY_LABELS = {
    work: 'Œuvre',
    series: 'Série',
    format: 'Format',
    technique: 'Technique',
    collector: 'Collectionneur',
  };

  let token = '';
  let resolvedApiBase = '';

  const loginEl = document.getElementById('audit-login');
  const appEl = document.getElementById('audit-app');
  const passEl = document.getElementById('audit-pass');
  const loginBtn = document.getElementById('audit-login-btn');
  const loginErr = document.getElementById('audit-login-error');
  const apiHint = document.getElementById('audit-api-hint');
  const tbody = document.getElementById('audit-tbody');
  const countEl = document.getElementById('audit-count');
  const statusEl = document.getElementById('audit-status');
  const reloadBtn = document.getElementById('audit-reload-btn');

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
    const meta = document.querySelector('meta[name="audit-log-api"]');
    const metaUrl = meta && meta.getAttribute('content');
    if (metaUrl && !metaUrl.includes('127.0.0.1')) {
      resolvedApiBase = String(metaUrl).trim().replace(/\/$/, '');
      return resolvedApiBase;
    }
    if (isProductionHost()) {
      resolvedApiBase = PRODUCTION_API;
      return resolvedApiBase;
    }
    resolvedApiBase = 'http://127.0.0.1:47836';
    return resolvedApiBase;
  }

  async function supabaseAnonKey() {
    const meta = document.querySelector('meta[name="supabase-anon-key"]');
    return meta ? String(meta.getAttribute('content') || '').trim() : '';
  }

  async function apiFetch(path, opts) {
    const base = await apiBase();
    const headers = { ...(opts && opts.headers) };
    const anon = await supabaseAnonKey();
    if (anon && base.includes('supabase.co')) {
      headers.apikey = anon;
      headers.Authorization = 'Bearer ' + anon;
    }
    return fetch(base + path, { ...opts, headers });
  }

  function setStatus(msg, isError) {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.classList.toggle('legend-editor-api-hint--error', !!isError);
  }

  function formatDateTime(iso) {
    try {
      return new Date(iso).toLocaleString('fr-FR', {
        dateStyle: 'short',
        timeStyle: 'medium',
      });
    } catch {
      return String(iso || '');
    }
  }

  function formatEntity(entry) {
    const type = ENTITY_LABELS[entry.entity_type] || entry.entity_type;
    return type + ' — ' + entry.entity_key;
  }

  function renderSnapshot(snapshot) {
    if (!snapshot || (typeof snapshot === 'object' && !Object.keys(snapshot).length)) {
      const span = document.createElement('span');
      span.className = 'audit-log-empty-snapshot';
      span.textContent = '(nouveau)';
      return span;
    }
    const pre = document.createElement('pre');
    pre.className = 'audit-log-snapshot';
    pre.textContent = JSON.stringify(snapshot, null, 2);
    return pre;
  }

  function renderTable(entries) {
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!entries.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.textContent = 'Aucune modification enregistrée.';
      td.className = 'audit-log-empty';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    for (const e of entries) {
      const tr = document.createElement('tr');
      const tdWhen = document.createElement('td');
      tdWhen.textContent = formatDateTime(e.created_at);
      tdWhen.className = 'audit-log-when';

      const tdRole = document.createElement('td');
      tdRole.textContent = ROLE_LABELS[e.editor_role] || e.editor_role;

      const tdAction = document.createElement('td');
      tdAction.textContent = ACTION_LABELS[e.action_type] || e.action_type;
      tdAction.className =
        'audit-log-action' +
        (e.action_type === 'delete' ? ' audit-log-action--delete' : '');

      const tdEntity = document.createElement('td');
      tdEntity.textContent = formatEntity(e);
      tdEntity.className = 'audit-log-entity';

      const tdSnap = document.createElement('td');
      tdSnap.appendChild(renderSnapshot(e.snapshot_before));

      tr.appendChild(tdWhen);
      tr.appendChild(tdRole);
      tr.appendChild(tdAction);
      tr.appendChild(tdEntity);
      tr.appendChild(tdSnap);
      tbody.appendChild(tr);
    }
  }

  async function loadLog() {
    setStatus('Chargement…');
    const r = await apiFetch('/api/audit-log?token=' + encodeURIComponent(token));
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.error || 'chargement impossible');
    renderTable(j.entries || []);
    if (countEl) countEl.textContent = (j.entries || []).length + ' entrée(s)';
    setStatus('');
  }

  function showApp() {
    if (loginEl) loginEl.hidden = true;
    if (appEl) appEl.hidden = false;
  }

  async function enterApp() {
    showApp();
    try {
      await loadLog();
    } catch (e) {
      setStatus(String(e.message || e), true);
    }
  }

  async function showApiHint() {
    if (!apiHint) return;
    const base = await apiBase();
    apiHint.textContent = isLocalDevServer()
      ? 'API locale : ' + base
      : 'API : ' + base.replace(/^https:\/\//, '');
  }

  const ec = AUTH();
  if (ec && ec.bindEditorLogin && loginBtn && passEl) {
    ec.bindEditorLogin({
      passEl,
      loginBtn,
      loginErr,
      loginRoot: loginEl,
      getApiBase: apiBase,
      requiredTabId: 'audit-log',
      onSuccess: async () => {
        token = ec.getSessionToken() || '';
        ec.mountEditorTabs();
        await enterApp();
      },
    });
  }

  if (reloadBtn) {
    reloadBtn.addEventListener('click', () => {
      loadLog().catch((e) => setStatus(String(e.message || e), true));
    });
  }

  showApiHint();
  if (ec && ec.hasSession() && ec.isAdmin()) {
    token = ec.getSessionToken() || '';
    ec.validateSession(apiBase()).then((valid) => {
      if (valid && ec.canAccessTab('audit-log')) {
        ec.mountEditorTabs();
        enterApp();
      } else {
        ec.clearSession();
      }
    });
  }
})();
