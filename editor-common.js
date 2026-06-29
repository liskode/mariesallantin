/**
 * Composants partagés des éditeurs (corbeille, navigation par onglets, authentification).
 */
(function (global) {
  const TRASH_ICON =
    '<svg class="editor-delete-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M6 7h12v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7zm3-4h6l1 2H8l1-2zm-1 6v9h2V9H8zm4 0v9h2V9h-2z"/></svg>';

  const ROLES = Object.freeze({ ARTIST: 'artist', ADMIN: 'admin' });

  /** @type {Array<{ id: string, label: string, href: string, port: number, adminOnly?: boolean }>} */
  const EDITOR_TABS = [
    { id: 'works', label: 'Œuvres', href: 'works-editor.html', port: 47835 },
    { id: 'series', label: 'Séries', href: 'series.html', port: 47833 },
    { id: 'codes', label: 'Formats & techniques', href: 'codes-editor.html', port: 47834 },
    { id: 'collectors', label: 'Collectionneurs', href: 'collectors.html', port: 47832 },
    { id: 'audit-log', label: 'Journal', href: 'audit-log.html', port: 47836, adminOnly: true },
  ];

  const LOCAL_EDITOR_PORTS = new Set(['47832', '47833', '47834', '47835', '47836']);
  const SAVE_BTN_LABEL_DIRTY = 'Enregistrer les modifications';
  const SAVE_BTN_LABEL_CLEAN = 'Modifications enregistrées';
  const AUTH_STORAGE_KEY = 'mariesallantin_editor_token';
  const AUTH_ROLE_KEY = 'mariesallantin_editor_role';
  const AUTH_EXPIRES_KEY = 'mariesallantin_editor_expires';
  const LEGACY_AUTH_KEYS = [
    'works_edit_ok',
    'series_edit_ok',
    'codes_edit_ok',
    'collectors_edit_ok',
    'catalogue_edit_mode_ok',
  ];

  function clearLegacyAuth() {
    LEGACY_AUTH_KEYS.forEach((k) => sessionStorage.removeItem(k));
  }

  function getSessionToken() {
    return sessionStorage.getItem(AUTH_STORAGE_KEY) || '';
  }

  function getSessionRole() {
    const role = sessionStorage.getItem(AUTH_ROLE_KEY);
    if (role === ROLES.ARTIST || role === ROLES.ADMIN) return role;
    return null;
  }

  function getSessionExpiresAt() {
    const raw = sessionStorage.getItem(AUTH_EXPIRES_KEY);
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function isSessionExpired() {
    const exp = getSessionExpiresAt();
    return exp > 0 && Date.now() >= exp;
  }

  function hasSession() {
    const token = getSessionToken();
    if (!token || !getSessionRole()) return false;
    if (isSessionExpired()) {
      clearSession();
      return false;
    }
    return true;
  }

  function isAdmin() {
    return hasSession() && getSessionRole() === ROLES.ADMIN;
  }

  function isArtist() {
    return hasSession() && getSessionRole() === ROLES.ARTIST;
  }

  function canDelete() {
    return isAdmin();
  }

  function canAccessTab(tabId) {
    const tab = EDITOR_TABS.find((t) => t.id === tabId);
    if (!tab) return false;
    if (!tab.adminOnly) return hasSession();
    return isAdmin();
  }

  function setSession(token, role, expiresAt) {
    sessionStorage.setItem(AUTH_STORAGE_KEY, String(token || '').trim());
    sessionStorage.setItem(AUTH_ROLE_KEY, role);
    if (expiresAt) sessionStorage.setItem(AUTH_EXPIRES_KEY, String(expiresAt));
    else sessionStorage.removeItem(AUTH_EXPIRES_KEY);
    clearLegacyAuth();
    document.body.dataset.editorRole = role;
  }

  function clearSession() {
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
    sessionStorage.removeItem(AUTH_ROLE_KEY);
    sessionStorage.removeItem(AUTH_EXPIRES_KEY);
    clearLegacyAuth();
    delete document.body.dataset.editorRole;
  }

  function getSelectedLoginRole(root) {
    const scope = root || document;
    const checked = scope.querySelector('input[name="editor-role"]:checked');
    const value = checked ? String(checked.value || '').trim().toLowerCase() : ROLES.ARTIST;
    return value === ROLES.ADMIN ? ROLES.ADMIN : ROLES.ARTIST;
  }

  /**
   * @param {string} apiBase
   * @param {string} role
   * @param {string} password
   */
  async function loginWithPassword(apiBase, role, password) {
    const base = String(apiBase || '').trim().replace(/\/$/, '');
    if (!base) throw new Error('API indisponible');

    const r = await fetch(base + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, password }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) {
      throw new Error(j.error || 'Identifiants incorrects.');
    }
    setSession(j.token, j.role || role, j.expiresAt || Date.now() + (j.expiresIn || 0));
    return j;
  }

  /**
   * @param {string} apiBase
   */
  async function validateSession(apiBase) {
    const token = getSessionToken();
    if (!token) return false;
    const base = String(apiBase || '').trim().replace(/\/$/, '');
    if (!base) return hasSession();

    try {
      const r = await fetch(
        base + '/api/session?token=' + encodeURIComponent(token),
        { cache: 'no-store' }
      );
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) {
        clearSession();
        return false;
      }
      setSession(token, j.role || getSessionRole(), j.expiresAt || getSessionExpiresAt());
      return true;
    } catch {
      return hasSession();
    }
  }

  /**
   * @param {{ passEl?: HTMLInputElement | null, loginBtn?: HTMLButtonElement | null, loginErr?: HTMLElement | null, loginRoot?: HTMLElement | null, getApiBase: () => Promise<string> | string, onSuccess: () => void | Promise<void>, requiredTabId?: string }} cfg
   */
  function bindEditorLogin(cfg) {
    const {
      passEl,
      loginBtn,
      loginErr,
      loginRoot,
      getApiBase,
      onSuccess,
      requiredTabId,
    } = cfg || {};

    async function tryLogin() {
      const pass = passEl ? passEl.value : '';
      const role = getSelectedLoginRole(loginRoot || passEl?.closest('.catalogue-login'));
      if (!pass) {
        if (loginErr) {
          loginErr.textContent = 'Saisissez votre mot de passe.';
          loginErr.hidden = false;
        }
        return;
      }
      if (loginBtn) loginBtn.disabled = true;
      if (loginErr) loginErr.hidden = true;
      try {
        const base = typeof getApiBase === 'function' ? await getApiBase() : getApiBase;
        await loginWithPassword(base, role, pass);
        if (requiredTabId && !canAccessTab(requiredTabId)) {
          clearSession();
          throw new Error('Accès réservé aux administrateurs.');
        }
        if (passEl) passEl.value = '';
        await onSuccess();
      } catch (e) {
        if (loginErr) {
          loginErr.textContent = String(e.message || e);
          loginErr.hidden = false;
        }
      } finally {
        if (loginBtn) loginBtn.disabled = false;
      }
    }

    if (loginBtn) loginBtn.addEventListener('click', tryLogin);
    if (passEl) {
      passEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') tryLogin();
      });
    }
    return { tryLogin };
  }

  /**
   * @param {HTMLButtonElement | null} btn
   * @param {boolean} dirty
   */
  function updateSaveButton(btn, dirty) {
    if (!btn) return;
    btn.disabled = !dirty;
    btn.classList.toggle('legend-editor-btn--save-dirty', dirty);
    btn.classList.toggle('legend-editor-btn--save-clean', !dirty);
    btn.textContent = dirty ? SAVE_BTN_LABEL_DIRTY : SAVE_BTN_LABEL_CLEAN;
  }

  /**
   * @param {number} count
   * @param {{ code?: string, label?: string, onDelete: () => void }} opts
   * @returns {HTMLTableCellElement}
   */
  function appendDeleteCell(tr, count, opts) {
    const td = document.createElement('td');
    td.className = 'editor-action-cell';
    if (count === 0 && opts && typeof opts.onDelete === 'function' && isAdmin()) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'editor-delete-btn';
      btn.title = opts.title || 'Supprimer ce code';
      btn.setAttribute(
        'aria-label',
        opts.ariaLabel || (opts.code ? 'Supprimer ' + opts.code : 'Supprimer')
      );
      btn.innerHTML = TRASH_ICON;
      btn.addEventListener('click', opts.onDelete);
      td.appendChild(btn);
    }
    tr.appendChild(td);
    return td;
  }

  function tabHref(tab) {
    const host = window.location.hostname || '';
    const port = window.location.port || '';
    if (
      (host === '127.0.0.1' || host === 'localhost') &&
      LOCAL_EDITOR_PORTS.has(port)
    ) {
      return 'http://127.0.0.1:' + tab.port + '/' + tab.href;
    }
    return tab.href;
  }

  /**
   * @param {string} activeId
   * @returns {HTMLElement}
   */
  function renderEditorTabs(activeId) {
    const nav = document.createElement('nav');
    nav.className = 'editor-tabs-nav';
    nav.setAttribute('aria-label', 'Édition catalogue');

    const inner = document.createElement('div');
    inner.className = 'catalogue-standalone-inner editor-tabs-inner';

    const list = document.createElement('div');
    list.className = 'editor-tabs-list';
    list.setAttribute('role', 'tablist');

    const role = getSessionRole();
    EDITOR_TABS.forEach((tab) => {
      if (tab.adminOnly && role === ROLES.ARTIST) return;
      const isActive = tab.id === activeId;
      const link = document.createElement('a');
      link.className = 'editor-tab' + (isActive ? ' editor-tab--active' : '');
      link.href = tabHref(tab);
      link.textContent = tab.label;
      link.setAttribute('role', 'tab');
      if (isActive) {
        link.setAttribute('aria-current', 'page');
      }
      list.appendChild(link);
    });

    if (hasSession()) {
      const logout = document.createElement('button');
      logout.type = 'button';
      logout.className = 'editor-logout-btn';
      logout.textContent = 'Déconnexion';
      logout.addEventListener('click', () => {
        clearSession();
        window.location.reload();
      });
      inner.appendChild(list);
      inner.appendChild(logout);
    } else {
      inner.appendChild(list);
    }

    nav.appendChild(inner);
    return nav;
  }

  function mountEditorTabs() {
    const activeId = document.body.getAttribute('data-editor-tab');
    if (!activeId) return;

    const tabs = renderEditorTabs(activeId);
    const mount = document.getElementById('editor-tabs-mount');
    if (mount) {
      mount.replaceWith(tabs);
      return;
    }

    const header = document.querySelector('.catalogue-standalone-header');
    if (header && header.parentNode) {
      header.insertAdjacentElement('afterend', tabs);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountEditorTabs);
  } else {
    mountEditorTabs();
  }

  const FORMAT_FAMILY_ORDER = ['F', 'P', 'C', 'M'];
  const FORMAT_FAMILY_LABELS = { F: 'Figure', P: 'Paysage', C: 'Carré', M: 'Marine', _: 'Hors Format' };

  function formatFamily(code) {
    const last = String(code || '').trim().toUpperCase().slice(-1);
    if (last === 'F' || last === 'P' || last === 'C' || last === 'M') return last;
    return '_';
  }

  function familyOrderIndex(family) {
    const i = FORMAT_FAMILY_ORDER.indexOf(family);
    return i === -1 ? FORMAT_FAMILY_ORDER.length : i;
  }

  function codeOfFormat(item) {
    return String(typeof item === 'string' ? item : item?.code || '')
      .trim()
      .toUpperCase();
  }

  function compareFormatCodes(a, b) {
    const ca = codeOfFormat(a);
    const cb = codeOfFormat(b);
    const fa = formatFamily(ca);
    const fb = formatFamily(cb);
    const oa = familyOrderIndex(fa);
    const ob = familyOrderIndex(fb);
    if (oa !== ob) return oa - ob;
    if (fa === '_' && fb === '_') {
      const lastCmp = ca.slice(-1).localeCompare(cb.slice(-1), 'fr');
      if (lastCmp !== 0) return lastCmp;
    }
    const prefixCmp = ca.slice(0, 3).localeCompare(cb.slice(0, 3), 'fr', { numeric: true });
    if (prefixCmp !== 0) return prefixCmp;
    return ca.localeCompare(cb, 'fr');
  }

  function sortFormats(list) {
    return [...(list || [])].sort(compareFormatCodes);
  }

  function groupFormatsByFamily(list) {
    const sorted = sortFormats(list);
    const buckets = new Map();
    for (const item of sorted) {
      const key = formatFamily(item.code);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(item);
    }
    const groups = [];
    for (const key of [...FORMAT_FAMILY_ORDER, '_']) {
      const items = buckets.get(key);
      if (!items?.length) continue;
      groups.push({
        family: key,
        label: FORMAT_FAMILY_LABELS[key] || null,
        items,
      });
    }
    return groups;
  }

  if (getSessionRole()) {
    document.body.dataset.editorRole = getSessionRole();
  }

  global.EditorCommon = {
    TRASH_ICON,
    EDITOR_TABS,
    ROLES,
    getSessionToken,
    getSessionRole,
    hasSession,
    isAdmin,
    isArtist,
    canDelete,
    canAccessTab,
    setSession,
    clearSession,
    loginWithPassword,
    validateSession,
    bindEditorLogin,
    getSelectedLoginRole,
    updateSaveButton,
    SAVE_BTN_LABEL_DIRTY,
    SAVE_BTN_LABEL_CLEAN,
    appendDeleteCell,
    renderEditorTabs,
    mountEditorTabs,
    sortFormats,
    groupFormatsByFamily,
    compareFormatCodes,
  };
})(window);
