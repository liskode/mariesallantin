/**
 * Éditeur collectionneurs — API locale (dev) ou Edge Function Supabase (en ligne).
 */
(function () {
  const AUTH = () => window.EditorCommon;
  const COLLECTOR_TYPES = ['Galerie', 'Institutions', 'Particulier'];
  const MEDIA_BASE = 'media/';
  const PRODUCTION_API =
    'https://leezsypadtvypdgqgvtk.supabase.co/functions/v1/collectors-api';
  const RASTER_EXT = new Set([
    '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.avif',
  ]);

  /** @type {{ collectorsApiUrl?: string, anonKey?: string } | null} */
  let siteConfig = null;
  /** @type {string} */
  let resolvedApiBase = '';
  /** @type {Map<string, string> | null} */
  let workMediaById = null;

  async function loadSiteConfig() {
    if (siteConfig) return siteConfig;
    siteConfig = {};
    try {
      const r = await fetch(MEDIA_BASE + 'collectors-config.json', { cache: 'no-store' });
      if (r.ok) siteConfig = await r.json();
    } catch {
      /* config optionnelle */
    }
    return siteConfig;
  }

  function isLocalDevServer() {
    return typeof window !== 'undefined' && window.location.port === '47832';
  }

  function isProductionHost() {
    const h = String(window.location.hostname || '');
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
    const fromMeta = document.querySelector('meta[name="collectors-api"]');
    const metaUrl = fromMeta && fromMeta.getAttribute('content');
    if (metaUrl && !metaUrl.includes('127.0.0.1')) {
      resolvedApiBase = String(metaUrl).trim().replace(/\/$/, '');
      return resolvedApiBase;
    }
    const cfg = await loadSiteConfig();
    if (cfg.collectorsApiUrl) {
      resolvedApiBase = String(cfg.collectorsApiUrl).trim().replace(/\/$/, '');
      return resolvedApiBase;
    }
    if (isProductionHost()) {
      resolvedApiBase = PRODUCTION_API;
      return resolvedApiBase;
    }
    resolvedApiBase = 'http://127.0.0.1:47832';
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
    if (cfg.anonKey) return String(cfg.anonKey).trim();
    return '';
  }

  async function apiFetch(pathAndQuery, init) {
    const base = await apiBase();
    const headers = new Headers((init && init.headers) || {});
    if (init && init.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    if (isOnlineApi(base)) {
      const anon = await supabaseAnonKey();
      if (!anon) {
        throw new Error(
          'Clé anon Supabase manquante : renseignez anonKey dans media/collectors-config.json'
        );
      }
      headers.set('apikey', anon);
      headers.set('Authorization', 'Bearer ' + anon);
    }
    return fetch(base + pathAndQuery, { ...init, headers });
  }

  function pathExtLower(filePart) {
    const i = filePart.lastIndexOf('.');
    return i >= 0 ? filePart.slice(i).toLowerCase() : '';
  }

  function webThumbRelFromMediaFp(mediaFp) {
    const fp = String(mediaFp || '').trim().replace(/\\/g, '/');
    if (!fp.toLowerCase().startsWith('catalogue/')) return null;
    const rest = fp.slice('catalogue/'.length);
    const lastSlash = rest.lastIndexOf('/');
    const filePart = lastSlash >= 0 ? rest.slice(lastSlash + 1) : rest;
    if (!RASTER_EXT.has(pathExtLower(filePart))) return null;
    const stem = filePart.replace(/\.[^.]+$/i, '');
    const dirPart = lastSlash >= 0 ? rest.slice(0, lastSlash) : '';
    return dirPart
      ? 'catalogue/_thumbs/' + dirPart + '/' + stem + '.webp'
      : 'catalogue/_thumbs/' + stem + '.webp';
  }

  function encodeMediaPath(url) {
    return String(url)
      .split('/')
      .map((seg, i) =>
        i === 0 ? seg : encodeURIComponent(String(seg).normalize('NFC'))
      )
      .join('/');
  }

  function workImageUrlsFromMedia(mediaFp) {
    const rel = String(mediaFp || '').trim().replace(/\\/g, '/');
    if (!rel) return { thumb_url: null, full_url: null };
    const thumbRel = webThumbRelFromMediaFp(rel);
    const full_url = MEDIA_BASE + encodeMediaPath(rel);
    const thumb_url = thumbRel ? MEDIA_BASE + encodeMediaPath(thumbRel) : full_url;
    return { thumb_url, full_url };
  }

  async function loadWorkMediaMap() {
    if (workMediaById) return workMediaById;
    workMediaById = new Map();
    try {
      const r = await fetch(MEDIA_BASE + 'works.json', { cache: 'default' });
      if (r.ok) {
        const j = await r.json();
        for (const w of j.works || []) {
          if (w.id && w.media) workMediaById.set(w.id, String(w.media));
        }
      }
    } catch {
      /* vignettes optionnelles */
    }
    return workMediaById;
  }

  async function enrichCollectorsWithThumbs(list) {
    const base = await apiBase();
    if (isLocalDevServer() || !isOnlineApi(base)) return list;
    const mediaMap = await loadWorkMediaMap();
    for (const c of list) {
      for (const w of c.works || []) {
        if (w.thumb_url) continue;
        const urls = workImageUrlsFromMedia(mediaMap.get(w.id));
        w.thumb_url = urls.thumb_url;
        w.full_url = urls.full_url;
      }
    }
    return list;
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
      const base = await apiBase();
      const r = await apiFetch('/api/health');
      const j = await r.json();
      if (apiHint) {
        if (j.ok) {
          apiHint.textContent = isOnlineApi(base)
            ? 'API en ligne (Supabase Edge Function).'
            : 'API locale détectée (' + base + ').';
        } else {
          apiHint.textContent = 'API : réponse inattendue.';
        }
      }
      return !!j.ok;
    } catch (e) {
      if (apiHint) {
        const base = await apiBase();
        apiHint.textContent = isOnlineApi(base)
          ? 'API en ligne indisponible. Vérifiez le déploiement Edge Function et anonKey.'
          : 'API locale non joignable. Lancez : npm run collectors:api';
      }
      return false;
    }
  }

  function rowKey(c) {
    return c.code || c._tempId;
  }

  function updateSaveBtn() {
    EditorCommon.updateSaveButton(saveBtn, dirtyCodes.size > 0);
  }

  function markDirty(code) {
    dirtyCodes.add(code);
    updateSaveBtn();
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

      tr.appendChild(tdCode);
      tr.appendChild(tdName);
      tr.appendChild(tdType);
      tr.appendChild(textCell('first_name'));
      tr.appendChild(textCell('phone'));
      tr.appendChild(textCell('email'));
      tr.appendChild(tdNotes);
      tr.appendChild(tdCount);

      if (window.EditorCommon) {
        window.EditorCommon.appendDeleteCell(tr, c.work_count || 0, {
          code: c.code,
          onDelete: () => deleteCollector(c),
        });
      } else {
        const tdActions = document.createElement('td');
        tdActions.className = 'editor-action-cell';
        tr.appendChild(tdActions);
      }

      tbody.appendChild(tr);
    }

    if (countEl) {
      countEl.textContent = collectors.length + ' collectionneur(s)';
    }
  }

  async function loadCollectors() {
    setStatus('Chargement…');
    const r = await apiFetch('/api/collectors?token=' + encodeURIComponent(token));
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'chargement impossible');
    collectors = await enrichCollectorsWithThumbs(j.collectors || []);
    dirtyCodes.clear();
    updateSaveBtn();
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

    try {
      const r = await apiFetch('/api/collectors/save', {
        method: 'POST',
        body: JSON.stringify({ token, collectors: toSave }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'échec enregistrement');

      collectors = await enrichCollectorsWithThumbs(j.collectors || collectors);
      dirtyCodes.clear();
      renderTable();
      setStatus('Enregistré (' + toSave.length + ' fiche(s)).');
    } finally {
      updateSaveBtn();
    }
  }

  async function createCollector() {
    const name = window.prompt('Nom du nouveau collectionneur :');
    if (!name || !name.trim()) return;

    setStatus('Création…');
    const r = await apiFetch('/api/collectors/create', {
      method: 'POST',
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

    collectors = await enrichCollectorsWithThumbs(j.collectors || collectors);
    renderTable();
    setStatus('Collectionneur créé : ' + (j.collector && j.collector.code));
  }

  async function deleteCollector(c) {
    if (!c.code) return;
    if ((c.work_count || 0) > 0) return;
    if (!window.confirm('Supprimer ' + c.code + ' — ' + c.name + ' ?')) return;

    setStatus('Suppression…');
    const r = await apiFetch(
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

  async function enterApp() {
    const apiOk = await checkApiHealth();
    if (!apiOk) {
      if (loginErr) {
        const base = await apiBase();
        loginErr.textContent = isOnlineApi(base)
          ? 'API en ligne indisponible (Edge Function ou anonKey).'
          : 'API locale indisponible. Lancez npm run collectors:api';
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

  const ec = AUTH();
  if (ec && ec.bindEditorLogin && loginBtn && passEl) {
    ec.bindEditorLogin({
      passEl,
      loginBtn,
      loginErr,
      loginRoot: loginEl,
      getApiBase: apiBase,
      requiredTabId: 'collectors',
      onSuccess: async () => {
        token = ec.getSessionToken() || '';
        ec.mountEditorTabs();
        await enterApp();
      },
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

  async function updateIntroText() {
    const el = document.getElementById('collectors-intro');
    if (!el) return;
    const base = await apiBase();
    if (isOnlineApi(base)) {
      el.textContent =
        'Éditeur en ligne — données Supabase. Enregistrez avant de quitter. Les vignettes sont servies depuis ce site.';
    } else if (isLocalDevServer()) {
      el.textContent =
        'Mode développement local : API et fichiers media sur cette machine.';
    } else {
      el.textContent =
        'Développement local : npm run collectors:api puis http://127.0.0.1:47832/';
    }
  }

  updateIntroText();
  checkApiHealth();
  if (ec && ec.hasSession()) {
    token = ec.getSessionToken() || '';
    ec.validateSession(apiBase()).then((valid) => {
      if (valid && ec.canAccessTab('collectors')) {
        ec.mountEditorTabs();
        enterApp();
      } else {
        ec.clearSession();
      }
    });
  }
})();
