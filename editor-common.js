/**
 * Composants partagés des éditeurs (corbeille codes orphelins).
 */
(function (global) {
  const TRASH_ICON =
    '<svg class="editor-delete-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M6 7h12v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7zm3-4h6l1 2H8l1-2zm-1 6v9h2V9H8zm4 0v9h2V9h-2z"/></svg>';

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

  global.EditorCommon = {
    TRASH_ICON,
    appendDeleteCell,
  };
})(window);
