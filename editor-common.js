/**
 * Composants partagés des éditeurs (corbeille, navigation par onglets).
 */
(function (global) {
  const TRASH_ICON =
    '<svg class="editor-delete-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M6 7h12v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7zm3-4h6l1 2H8l1-2zm-1 6v9h2V9H8zm4 0v9h2V9h-2z"/></svg>';

  /** @type {Array<{ id: string, label: string, href: string, port: number }>} */
  const EDITOR_TABS = [
    { id: 'works', label: 'Œuvres', href: 'works-editor.html', port: 47835 },
    { id: 'series', label: 'Séries', href: 'series.html', port: 47833 },
    { id: 'codes', label: 'Formats & techniques', href: 'codes-editor.html', port: 47834 },
    { id: 'collectors', label: 'Collectionneurs', href: 'collectors.html', port: 47832 },
  ];

  const LOCAL_EDITOR_PORTS = new Set(['47832', '47833', '47834', '47835']);
  const EDIT_PASS = 'MS75';
  const AUTH_STORAGE_KEY = 'mariesallantin_editor_token';
  const LEGACY_AUTH_KEYS = [
    'works_edit_ok',
    'series_edit_ok',
    'codes_edit_ok',
    'collectors_edit_ok',
    'catalogue_edit_mode_ok',
  ];

  function validatePassword(pass) {
    return String(pass || '').trim() === EDIT_PASS;
  }

  function migrateLegacyAuth() {
    for (const key of LEGACY_AUTH_KEYS) {
      if (sessionStorage.getItem(key) === '1') {
        sessionStorage.setItem(AUTH_STORAGE_KEY, EDIT_PASS);
        LEGACY_AUTH_KEYS.forEach((k) => sessionStorage.removeItem(k));
        return EDIT_PASS;
      }
    }
    return null;
  }

  function getSessionToken() {
    const stored = sessionStorage.getItem(AUTH_STORAGE_KEY);
    if (stored === EDIT_PASS) return stored;
    return migrateLegacyAuth();
  }

  function hasSession() {
    return getSessionToken() === EDIT_PASS;
  }

  function setSessionToken(pass) {
    const p = String(pass || '').trim();
    if (p !== EDIT_PASS) return false;
    sessionStorage.setItem(AUTH_STORAGE_KEY, p);
    LEGACY_AUTH_KEYS.forEach((k) => sessionStorage.removeItem(k));
    return true;
  }

  function clearSession() {
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
    LEGACY_AUTH_KEYS.forEach((k) => sessionStorage.removeItem(k));
  }

  /**
   * @param {number} count
   * @param {{ code?: string, label?: string, onDelete: () => void }} opts
   * @returns {HTMLTableCellElement}
   */
  function appendDeleteCell(tr, count, opts) {
    const td = document.createElement('td');
    td.className = 'editor-action-cell';
    if (count === 0 && opts && typeof opts.onDelete === 'function') {
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

    EDITOR_TABS.forEach((tab) => {
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

    inner.appendChild(list);
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

  global.EditorCommon = {
    TRASH_ICON,
    EDITOR_TABS,
    EDIT_PASS,
    validatePassword,
    getSessionToken,
    hasSession,
    setSessionToken,
    clearSession,
    appendDeleteCell,
    renderEditorTabs,
    mountEditorTabs,
  };
})(window);
