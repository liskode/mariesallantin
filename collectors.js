/**
 * Éditeur collectionneurs (Supabase via API locale collectors-editor-api).
 */
(function () {
  const EDIT_PASS = 'MS75';
  const AUTH_KEY = 'collectors_edit_ok';
  const COLLECTOR_TYPES = ['Galerie', 'Institutions', 'Particulier'];

  function apiBase() {
    if (typeof window !== 'undefined' && window.location.port === '47832') {
      return window.location.origin;
    }
    const el = document.querySelector('meta[name="collectors-api"]');
    const u = el && el.getAttribute('content');
    return String(u || '').trim() || 'http://127.0.0.1:47832';
  }

  const loginEl = document.getElementById('collectors-login');
  const appEl = document.getElementById('collectors-app');
  const passEl = document.getElementById('collectors-pass');
  const loginBtn = document.getElementById('collectors-login-btn');
  const loginErr = document.getElementById('collectors-login-error');
  const apiHint = document.getElementById('collectors-api-hint');
  const tbody = document.getElementById('collectors-tbody');
  const countEl = document.getElementById('collectors-count');
  const statusEl = document.getElementById('collectors-status');
  const saveBtn = document.getElementById('collectors-save-btn');
  const addBtn = document.getElementById('collectors-add-btn');
  const reloadBtn = document.getElementById('collectors-reload-btn');

  /** @type {Array<object>} */
  let collectors = [];
  const dirtyCodes = new Set();
  let token = '';

  function setStatus(msg, isError) {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.style.color = isError ? '#b00020' : '';
  }

  async function checkApiHealth() {
    try {
      const r = await fetch(apiBase() + '/api/health');
      const j = await r.json();
      if (apiHint) {
        apiHint.textContent = j.ok
          ? 'API locale détectée (' + apiBase() + ').'
          : 'API locale : réponse inattendue.';
      }
      return !!j.ok;
    } catch {
      if (apiHint) {
        apiHint.textContent =
          'API non joignable. Lancez : npm run collectors:api (' + apiBase() + ')';
      }
      return false;
    }
  }

  function rowKey(c) {
    return c.code || c._tempId;
  }

  function markDirty(code) {
    dirtyCodes.add(code);
    if (saveBtn) saveBtn.disabled = dirtyCodes.size === 0;
  }

  /** @type {HTMLDivElement | null} */
  let worksPopover = null;

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getWorksPopover() {
    if (!worksPopover) {
      worksPopover = document.createElement('div');
      worksPopover.id = 'collectors-works-popover';
      worksPopover.className = 'collectors-works-popover';
      worksPopover.hidden = true;
      document.body.appendChild(worksPopover);
    }
    return worksPopover;
  }

  function hideWorksPopover() {
    if (worksPopover) worksPopover.hidden = true;
  }

  /** @param {HTMLElement} anchor @param {object[]} works */
  function showWorksPopover(anchor, works) {
    if (!works.length) return;
    const pop = getWorksPopover();
    const items = works
      .map((w) => {
        const thumb = w.thumb_url || w.full_url || '';
        const full = w.full_url || w.thumb_url || '';
        const img =
          thumb
            ? '<img class="collectors-works-popover-thumb" src="' +
              escapeHtml(thumb) +
              '"' +
              (full && full !== thumb
                ? ' data-full="' + escapeHtml(full) + '"'
                : '') +
              ' alt="" loading="lazy" decoding="async" width="56" height="56" onerror="if(this.dataset.full&&this.src!==this.dataset.full){this.onerror=null;this.src=this.dataset.full}" />'
            : '<span class="collectors-works-popover-thumb collectors-works-popover-thumb--empty" aria-hidden="true"></span>';
        return (
          '<li class="collectors-works-popover-item">' +
          img +
          '<div class="collectors-works-popover-text">' +
          '<span class="collectors-works-popover-id">' +
          escapeHtml(w.id) +
          '</span>' +
          (w.title
            ? '<span class="collectors-works-popover-title">' +
              escapeHtml(w.title) +
              '</span>'
            : '') +
          '</div></li>'
        );
      })
      .join('');
    pop.innerHTML =
      '<p class="collectors-works-popover-heading">Œuvres liées</p><ul>' + items + '</ul>';

    pop.hidden = false;
    const rect = anchor.getBoundingClientRect();
    const margin = 8;
    let left = rect.left + rect.width / 2;
    let top = rect.bottom + margin;
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
    pop.style.transform = 'translateX(-50%)';

    requestAnimationFrame(() => {
      const pr = pop.getBoundingClientRect();
      let adjLeft = left;
      let adjTop = top;
      if (pr.right > window.innerWidth - margin) {
        adjLeft = window.innerWidth - margin - pr.width / 2;
      }
      if (pr.left < margin) {
        adjLeft = margin + pr.width / 2;
      }
      if (pr.bottom > window.innerHeight - margin) {
        adjTop = rect.top - margin - pr.height;
      }
      pop.style.left = adjLeft + 'px';
      pop.style.top = adjTop + 'px';
    });
  }

  function attachWorksCountHover(cell, collector) {
    const count = collector.work_count || 0;
    const works = collector.works || [];
    cell.textContent = String(count);
    if (count <= 0 || !works.length) return;

    cell.classList.add('collectors-count-cell--has-works');
    cell.title = '';
    cell.addEventListener('mouseenter', () => showWorksPopover(cell, works));
    cell.addEventListener('mouseleave', hideWorksPopover);
    cell.addEventListener('focus', () => showWorksPopover(cell, works));
    cell.addEventListener('blur', hideWorksPopover);
    cell.tabIndex = 0;
    cell.setAttribute('role', 'button');
    cell.setAttribute(
      'aria-label',
      count + ' œuvre(s) — survoler pour afficher la liste'
    );
  }

  function renderTable() {
    if (!tbody) return;
    tbody.innerHTML = '';

    for (const c of collectors) {
      const tr = document.createElement('tr');
      const key = rowKey(c);
      if (dirtyCodes.has(key)) tr.classList.add('legend-editor-row--dirty');

      const tdCode = document.createElement('td');
      tdCode.textContent = c.code || '(nouveau)';
      tdCode.className = 'collectors-code-cell';

      const tdName = document.createElement('td');
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'legend-input';
      nameInput.value = c.name || '';
      nameInput.required = true;
      nameInput.addEventListener('input', () => {
        c.name = nameInput.value;
        markDirty(key);
        tr.classList.add('legend-editor-row--dirty');
      });
      tdName.appendChild(nameInput);

      const tdType = document.createElement('td');
      const typeSel = document.createElement('select');
      typeSel.className = 'legend-select';
      for (const t of COLLECTOR_TYPES) {
        const opt = document.createElement('option');
        opt.value = t;
        opt.textContent = t;
        if (c.collector_type === t) opt.selected = true;
        typeSel.appendChild(opt);
      }
      typeSel.addEventListener('change', () => {
        c.collector_type = typeSel.value;
        markDirty(key);
        tr.classList.add('legend-editor-row--dirty');
      });
      tdType.appendChild(typeSel);

      function textCell(field) {
        const td = document.createElement('td');
        const input = document.createElement('input');
        input.type = field === 'email' ? 'email' : 'text';
        input.className = 'legend-input';
        input.value = c[field] || '';
        input.addEventListener('input', () => {
          c[field] = input.value;
          markDirty(key);
          tr.classList.add('legend-editor-row--dirty');
        });
        td.appendChild(input);
        return td;
      }

      const tdNotes = document.createElement('td');
      const notesInput = document.createElement('input');
      notesInput.type = 'text';
      notesInput.className = 'legend-input';
      notesInput.value = c.notes || '';
      notesInput.addEventListener('input', () => {
        c.notes = notesInput.value;
        markDirty(key);
        tr.classList.add('legend-editor-row--dirty');
      });
      tdNotes.appendChild(notesInput);

      const tdCount = document.createElement('td');
      tdCount.className = 'collectors-count-cell';
      attachWorksCountHover(tdCount, c);

      const tdActions = document.createElement('td');
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'catalogue-row-edit-btn';
      delBtn.textContent = 'Suppr.';
      delBtn.disabled = (c.work_count || 0) > 0 || !c.code;
      delBtn.title =
        (c.work_count || 0) > 0
          ? 'Des œuvres sont liées à ce collectionneur'
          : 'Supprimer ce collectionneur';
      delBtn.addEventListener('click', () => deleteCollector(c));
      tdActions.appendChild(delBtn);

      tr.appendChild(tdCode);
      tr.appendChild(tdName);
      tr.appendChild(tdType);
      tr.appendChild(textCell('first_name'));
      tr.appendChild(textCell('phone'));
      tr.appendChild(textCell('email'));
      tr.appendChild(tdNotes);
      tr.appendChild(tdCount);
      tr.appendChild(tdActions);
      tbody.appendChild(tr);
    }

    if (countEl) {
      countEl.textContent = collectors.length + ' collectionneur(s)';
    }
  }

  async function loadCollectors() {
    setStatus('Chargement…');
    const r = await fetch(
      apiBase() + '/api/collectors?token=' + encodeURIComponent(token)
    );
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'chargement impossible');
    collectors = j.collectors || [];
    dirtyCodes.clear();
    if (saveBtn) saveBtn.disabled = true;
    renderTable();
    setStatus('');
  }

  async function saveDirty() {
    const toSave = collectors.filter((c) => c.code && dirtyCodes.has(c.code));
    if (!toSave.length) {
      setStatus('Rien à enregistrer.');
      return;
    }

    saveBtn.disabled = true;
    setStatus('Enregistrement…');

    const r = await fetch(apiBase() + '/api/collectors/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, collectors: toSave }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'échec enregistrement');

    collectors = j.collectors || collectors;
    dirtyCodes.clear();
    renderTable();
    setStatus('Enregistré (' + toSave.length + ' fiche(s)).');
  }

  async function createCollector() {
    const name = window.prompt('Nom du nouveau collectionneur :');
    if (!name || !name.trim()) return;

    setStatus('Création…');
    const r = await fetch(apiBase() + '/api/collectors/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    if (!j.ok) throw new Error(j.error || 'création impossible');

    collectors = j.collectors || collectors;
    renderTable();
    setStatus('Collectionneur créé : ' + (j.collector && j.collector.code));
  }

  async function deleteCollector(c) {
    if (!c.code) return;
    if (!window.confirm('Supprimer ' + c.code + ' — ' + c.name + ' ?')) return;

    setStatus('Suppression…');
    const r = await fetch(
      apiBase() +
        '/api/collectors/' +
        encodeURIComponent(c.code) +
        '?token=' +
        encodeURIComponent(token),
      { method: 'DELETE' }
    );
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'suppression impossible');

    collectors = collectors.filter((x) => x.code !== c.code);
    dirtyCodes.delete(c.code);
    renderTable();
    setStatus('Supprimé : ' + c.code);
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

    const apiOk = await checkApiHealth();
    if (!apiOk) {
      if (loginErr) {
        loginErr.textContent = 'API locale indisponible. Lancez npm run collectors:api';
        loginErr.hidden = false;
      }
      return;
    }

    if (loginErr) loginErr.hidden = true;
    showApp();
    try {
      await loadCollectors();
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
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      createCollector().catch((e) => setStatus(String(e.message || e), true));
    });
  }
  if (reloadBtn) {
    reloadBtn.addEventListener('click', () => {
      loadCollectors().catch((e) => setStatus(String(e.message || e), true));
    });
  }

  checkApiHealth();
  if (sessionStorage.getItem(AUTH_KEY) === '1' && passEl) {
    passEl.value = EDIT_PASS;
    tryLogin();
  }
})();
