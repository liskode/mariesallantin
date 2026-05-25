/**
 * Catalogue : charge media/titles.txt et media/catalog-state.json,
 * filtres, tri, compteur affiché / total.
 */
(function () {
  if (typeof location !== 'undefined' && location.hostname === 'catalogue.mariesallantin.art') {
    var p = location.pathname;
    var idx = p.lastIndexOf('catalogue.html');
    if (idx !== -1) {
      var prefix = p.slice(0, idx).replace(/\/?$/, '');
      history.replaceState(null, '', (prefix ? prefix + '/' : '/') + location.search + location.hash);
    }
  }

  const MEDIA_BASE = 'media/';
  const titlesUrl = MEDIA_BASE + 'titles.txt';
  const stateUrl = MEDIA_BASE + 'catalog-state.json';

  const container = document.getElementById('catalogue-root');
  const previewImg = document.getElementById('catalogue-preview-img');
  if (!container) return;

  /** @type {Array<object>} */
  let allRows = [];
  /** @type {Map<string, { bytes?: number, w?: number, h?: number }>} */
  const metricsCache = new Map();

  let sortColumn = 'order';
  let sortDir = 'asc';

  function parseTitles(text) {
    const lines = text.split('\n');
    const seriesNames = {};
    const rows = [];

    lines.forEach((line) => {
      if (line.startsWith('#')) {
        const [code, name] = line.replace('#', '').split(';');
        if (code && name) {
          seriesNames[code.trim()] = name.trim();
        }
      } else if (line.includes('/') && line.includes(';')) {
        const [filePath, title] = line.split(';');
        const fp = filePath.trim();
        const folder = fp.split('/')[0];
        const fileName = fp.includes('/') ? fp.slice(fp.indexOf('/') + 1) : fp;
        const lastDot = fileName.lastIndexOf('.');
        const ext = lastDot >= 0 ? fileName.slice(lastDot) : '';
        rows.push({
          filePath: fp,
          folder,
          fileName,
          ext: ext || '—',
          seriesName: seriesNames[folder] || folder,
          title: (title || '').trim(),
          mediaUrl: MEDIA_BASE + fp,
        });
      }
    });

    return { rows, seriesNames };
  }

  function formatWeightKo(bytes) {
    if (bytes == null || Number.isNaN(bytes)) return '—';
    const ko = Math.round(bytes / 1024);
    return ko + ' Ko';
  }

  function fetchFileSize(url) {
    return fetch(url, { method: 'HEAD', cache: 'no-store' })
      .then((res) => {
        const cl = res.headers.get('Content-Length');
        if (cl) return parseInt(cl, 10);
        return null;
      })
      .catch(() => null);
  }

  function fetchFileSizeGet(url) {
    return fetch(url, { cache: 'no-store' })
      .then((res) => res.blob())
      .then((b) => b.size)
      .catch(() => null);
  }

  function loadImageDimensions(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () =>
        resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve({ w: null, h: null });
      img.src = url;
    });
  }

  function renderEtat(code) {
    if (code === 'P') {
      return (
        '<span class="catalogue-etat catalogue-etat--pub" title="Code P — publié sur le site public">Publié</span>'
      );
    }
    if (code === 'S') {
      return (
        '<span class="catalogue-etat catalogue-etat--sus" title="Code S — suspendu (non exposé sur le site public)">Suspendu</span>'
      );
    }
    return (
      '<span class="catalogue-etat catalogue-etat--none" title="Non renseigné dans catalog-state.json">—</span>'
    );
  }

  function normalizeEtat(raw) {
    if (raw === 'W') return 'P';
    return raw;
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function attachPreview(thumb, fullSrc) {
    thumb.addEventListener('mouseenter', (e) => {
      if (!previewImg) return;
      previewImg.src = fullSrc;
      previewImg.classList.add('is-visible');
      positionPreview(e);
    });
    thumb.addEventListener('mousemove', positionPreview);
    thumb.addEventListener('mouseleave', () => {
      if (previewImg) {
        previewImg.classList.remove('is-visible');
        previewImg.removeAttribute('src');
      }
    });

    function positionPreview(e) {
      if (!previewImg || !previewImg.classList.contains('is-visible')) return;
      const pad = 16;
      const w = previewImg.offsetWidth || 400;
      const h = previewImg.offsetHeight || 300;
      let x = e.clientX + pad;
      let y = e.clientY + pad;
      if (x + w > window.innerWidth - pad) x = e.clientX - w - pad;
      if (y + h > window.innerHeight - pad) y = e.clientY - h - pad;
      previewImg.style.left = Math.max(pad, x) + 'px';
      previewImg.style.top = Math.max(pad, y) + 'px';
    }
  }

  function mergeMetrics(filePath, patch) {
    const prev = metricsCache.get(filePath) || {};
    metricsCache.set(filePath, { ...prev, ...patch });
  }

  function fillMetrics(rowEl, filePath, mediaUrl) {
    const sizeEl = rowEl.querySelector('[data-metric="size"]');
    const resEl = rowEl.querySelector('[data-metric="res"]');
    const cached = metricsCache.get(filePath);

    function applyRes(w, h) {
      if (w && h) {
        resEl.textContent = w + ' × ' + h;
      } else {
        resEl.textContent = '—';
      }
      resEl.classList.remove('metric-pending');
    }

    function applySize(bytes) {
      if (bytes != null) {
        sizeEl.textContent = formatWeightKo(bytes);
      } else {
        sizeEl.textContent = '—';
      }
      sizeEl.classList.remove('metric-pending');
    }

    if (cached && cached.w != null && cached.h != null) {
      applyRes(cached.w, cached.h);
    } else {
      loadImageDimensions(mediaUrl).then(({ w, h }) => {
        mergeMetrics(filePath, { w: w || undefined, h: h || undefined });
        applyRes(w, h);
      });
    }

    if (cached && cached.bytes != null) {
      applySize(cached.bytes);
    } else {
      sizeEl.classList.add('metric-pending');
      fetchFileSize(mediaUrl).then((size) => {
        if (size != null) {
          mergeMetrics(filePath, { bytes: size });
          applySize(size);
          return;
        }
        return fetchFileSizeGet(mediaUrl).then((s) => {
          if (s != null) mergeMetrics(filePath, { bytes: s });
          applySize(s);
        });
      });
    }
  }

  function getEtatSortKey(etatDisplay) {
    if (etatDisplay === 'P') return 0;
    if (etatDisplay === 'S') return 1;
    return 2;
  }

  function getSortValue(row, col) {
    const m = metricsCache.get(row.filePath) || {};
    switch (col) {
      case 'order':
        return row.orderIndex;
      case 'folder':
        return row.folder;
      case 'fileName':
        return row.fileName;
      case 'ext':
        return row.ext;
      case 'seriesName':
        return row.seriesName;
      case 'title':
        return row.title;
      case 'mediaUrl':
        return row.mediaUrl;
      case 'bytes':
        return m.bytes != null ? m.bytes : null;
      case 'pixels':
        if (m.w != null && m.h != null) return m.w * m.h;
        return null;
      case 'etat':
        return getEtatSortKey(row.etatDisplay);
      default:
        return row.orderIndex;
    }
  }

  /** Valeurs manquantes (métriques pas encore chargées) en fin de liste. */
  function compareSort(a, b, col, dir) {
    const va = getSortValue(a, col);
    const vb = getSortValue(b, col);

    if (col === 'bytes' || col === 'pixels') {
      const aNull = va == null;
      const bNull = vb == null;
      if (aNull && bNull) return a.orderIndex - b.orderIndex;
      if (aNull) return 1;
      if (bNull) return -1;
      const diff = va - vb;
      if (diff !== 0) return dir === 'asc' ? diff : -diff;
      return a.orderIndex - b.orderIndex;
    }

    if (typeof va === 'number' && typeof vb === 'number') {
      const diff = va - vb;
      if (diff !== 0) return dir === 'asc' ? diff : -diff;
      return a.orderIndex - b.orderIndex;
    }

    const sa = String(va);
    const sb = String(vb);
    const diff = sa.localeCompare(sb, 'fr', { numeric: true, sensitivity: 'base' });
    if (diff !== 0) return dir === 'asc' ? diff : -diff;
    return a.orderIndex - b.orderIndex;
  }

  function filterRows(rows) {
    const fd = document.getElementById('catalogue-filter-dossier');
    const fs = document.getElementById('catalogue-filter-serie');
    const fe = document.getElementById('catalogue-filter-etat');
    const dossier = fd ? fd.value : '';
    const serie = fs ? fs.value : '';
    const etat = fe ? fe.value : '';

    return rows.filter((r) => {
      if (dossier && r.folder !== dossier) return false;
      if (serie && r.seriesName !== serie) return false;
      if (etat === 'none') {
        if (r.etatDisplay === 'P' || r.etatDisplay === 'S') return false;
      } else if (etat && r.etatDisplay !== etat) return false;
      return true;
    });
  }

  function sortRows(rows) {
    const copy = rows.slice();
    copy.sort((a, b) => compareSort(a, b, sortColumn, sortDir));
    return copy;
  }

  function updateSortHeaderUI() {
    document.querySelectorAll('.catalogue-th').forEach((th) => {
      th.removeAttribute('aria-sort');
    });
    document.querySelectorAll('.catalogue-sort-btn').forEach((btn) => {
      const key = btn.getAttribute('data-sort-key');
      const active = key === sortColumn;
      btn.classList.toggle('catalogue-sort-btn--active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      const up = btn.querySelector('.catalogue-sort-up');
      const down = btn.querySelector('.catalogue-sort-down');
      if (up) {
        up.classList.toggle('is-active', active && sortDir === 'asc');
      }
      if (down) {
        down.classList.toggle('is-active', active && sortDir === 'desc');
      }
      if (active) {
        const th = btn.closest('.catalogue-th');
        if (th) {
          th.setAttribute('aria-sort', sortDir === 'asc' ? 'ascending' : 'descending');
        }
      }
    });
  }

  function bindSortHeaders() {
    document.querySelectorAll('.catalogue-sort-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const key = btn.getAttribute('data-sort-key');
        if (!key) return;
        if (key === sortColumn) {
          sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          sortColumn = key;
          sortDir = 'asc';
        }
        updateSortHeaderUI();
        renderCatalogue();
      });
    });
  }

  function buildRowHtml(r) {
    const etatDisplay = r.etatDisplay;
    return (
      '<tr data-path="' +
      escapeHtml(r.filePath) +
      '">' +
      '<td class="col-thumb catalogue-thumb-cell">' +
      '<img class="catalogue-thumb" src="' +
      escapeHtml(r.mediaUrl) +
      '" alt="" loading="lazy" />' +
      '</td>' +
      '<td>' +
      escapeHtml(r.folder) +
      '</td>' +
      '<td>' +
      escapeHtml(r.fileName) +
      '</td>' +
      '<td>' +
      escapeHtml(r.ext) +
      '</td>' +
      '<td>' +
      escapeHtml(r.seriesName) +
      '</td>' +
      '<td class="col-legende">' +
      escapeHtml(r.title) +
      '</td>' +
      '<td class="col-url"><code>' +
      escapeHtml(r.mediaUrl) +
      '</code></td>' +
      '<td data-metric="size" class="metric-pending">…</td>' +
      '<td data-metric="res" class="metric-pending">…</td>' +
      '<td>' +
      renderEtat(etatDisplay) +
      '</td>' +
      '</tr>'
    );
  }

  function updateCount(shown, total) {
    const countEl = document.getElementById('catalogue-count');
    if (!countEl) return;
    const s = shown === 1 ? 'affiché' : 'affichés';
    countEl.innerHTML =
      '<strong>' +
      shown +
      '</strong> ' +
      s +
      ' sur <strong>' +
      total +
      '</strong>';
  }

  function populateFilterSelects() {
    const fd = document.getElementById('catalogue-filter-dossier');
    const fs = document.getElementById('catalogue-filter-serie');
    if (!fd || !fs) return;

    const folders = [...new Set(allRows.map((r) => r.folder))].sort((a, b) =>
      a.localeCompare(b, 'fr')
    );
    const series = [...new Set(allRows.map((r) => r.seriesName))].sort((a, b) =>
      a.localeCompare(b, 'fr')
    );

    fd.innerHTML = '';
    const optAllD = document.createElement('option');
    optAllD.value = '';
    optAllD.textContent = 'Tous';
    fd.appendChild(optAllD);
    folders.forEach((f) => {
      const o = document.createElement('option');
      o.value = f;
      o.textContent = f;
      fd.appendChild(o);
    });

    fs.innerHTML = '';
    const optAllS = document.createElement('option');
    optAllS.value = '';
    optAllS.textContent = 'Toutes';
    fs.appendChild(optAllS);
    series.forEach((name) => {
      const o = document.createElement('option');
      o.value = name;
      o.textContent = name;
      fs.appendChild(o);
    });
  }

  function bindFilterSelects() {
    ['catalogue-filter-dossier', 'catalogue-filter-serie', 'catalogue-filter-etat'].forEach(
      (id) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', renderCatalogue);
      }
    );
  }

  function renderCatalogue() {
    const tbody = document.getElementById('catalogue-tbody');
    if (!tbody) return;

    const filtered = filterRows(allRows);
    const sorted = sortRows(filtered);

    tbody.innerHTML = sorted.map(buildRowHtml).join('');

    const trs = tbody.querySelectorAll('tr');
    sorted.forEach((r, i) => {
      const rowEl = trs[i];
      if (!rowEl) return;
      const mediaUrl = r.mediaUrl;
      const thumb = rowEl.querySelector('.catalogue-thumb');
      if (thumb) attachPreview(thumb, mediaUrl);
      fillMetrics(rowEl, r.filePath, mediaUrl);
    });

    updateCount(sorted.length, allRows.length);
  }

  /** Mot de passe côté client (visible dans le code source ; protection légère). */
  const CATALOGUE_AUTH_KEY = 'catalogue_ms75_ok';
  const CATALOGUE_PASSWORD = 'MS75';

  function startCatalogue() {
    Promise.all([
      fetch(titlesUrl).then((r) => {
        if (!r.ok) throw new Error('Impossible de charger titles.txt');
        return r.text();
      }),
      fetch(stateUrl)
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({})),
    ])
      .then(([text, state]) => {
        const { rows } = parseTitles(text);
        allRows = rows.map((r, i) => {
          const etatRaw = state[r.filePath];
          const etatCode = normalizeEtat(etatRaw);
          const etatDisplay =
            etatCode === 'P' || etatCode === 'S' ? etatCode : null;
          return {
            ...r,
            orderIndex: i,
            etatDisplay,
          };
        });

        populateFilterSelects();
        bindFilterSelects();
        bindSortHeaders();
        updateSortHeaderUI();

        renderCatalogue();
        container.querySelector('.catalogue-loading')?.remove();
      })
      .catch((err) => {
        console.error(err);
        const ld = container && container.querySelector('.catalogue-loading');
        if (ld) {
          ld.className = 'catalogue-error';
          ld.textContent =
            'Erreur de chargement du catalogue. Ouvrez la page via un serveur HTTP local (les requêtes vers titles.txt et les images peuvent être bloquées en file://).';
        }
      });
  }

  function setupCatalogueAuth() {
    const loginEl = document.getElementById('catalogue-login');
    const appEl = document.getElementById('catalogue-app');
    const form = document.getElementById('catalogue-login-form');
    const input = document.getElementById('catalogue-login-input');
    const errEl = document.getElementById('catalogue-login-error');

    if (!loginEl || !appEl || !form || !input) {
      startCatalogue();
      return;
    }

    function unlock() {
      sessionStorage.setItem(CATALOGUE_AUTH_KEY, '1');
      loginEl.remove();
      appEl.hidden = false;
      startCatalogue();
    }

    if (sessionStorage.getItem(CATALOGUE_AUTH_KEY) === '1') {
      unlock();
      return;
    }

    appEl.hidden = true;
    input.focus();

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (errEl) errEl.hidden = true;
      if (input.value === CATALOGUE_PASSWORD) {
        unlock();
      } else {
        if (errEl) errEl.hidden = false;
        input.value = '';
        input.focus();
      }
    });
  }

  setupCatalogueAuth();
})();
