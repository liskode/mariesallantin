/**
 * Catalogue : charge media/works.json (ou titles.txt) et media/catalog-state.json.
 * Clés d’état : id œuvre (ex. MS0001), avec repli sur l’ancien chemin fichier.
 */
(function () {
  const MEDIA_BASE = 'media/';
  const stateUrl = MEDIA_BASE + 'catalog-state.json';
  const WORKS_URL = MEDIA_BASE + 'works.json';
  const EDIT_CODES_URL = MEDIA_BASE + 'editor-codes.json';
  const EDIT_PASS = 'MS75';
  const EDIT_AUTH_KEY = 'catalogue_edit_mode_ok';

  const DEFAULT_EDIT_CODES = {
    formats: [
      { code: 'HF23', label: '200x300' },
      { code: 'HF21', label: '210x' },
      { code: 'HF03', label: '' },
      { code: 'HF04', label: '' },
      { code: 'HF05', label: '' },
      { code: 'HF06', label: '' },
      { code: 'HF07', label: '' },
      { code: 'HF08', label: '' },
      { code: 'HF09', label: '' },
    ],
    techniques: [
      { code: 'TST', label: 'Tempera sur toile' },
      { code: 'TSB', label: 'Tempera sur bois' },
      { code: 'INK', label: 'Encre sur papier' },
      { code: 'HUI', label: 'Huile sur toile' },
      { code: 'AST', label: 'Acrylique sur toile' },
      { code: 'ASB', label: 'Acrylique sur bois' },
    ],
    series: [],
  };

  /** Extensions pour lesquelles on lit largeur × hauteur via decode navigateur. */
  const RASTER_IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif']);

  function rowExtLower(row) {
    return String(row.ext || '').toLowerCase();
  }

  function isRasterImageRow(row) {
    return RASTER_IMAGE_EXT.has(rowExtLower(row));
  }

  /** @returns {Promise<{ w: number, h: number } | null>} */
  function probeImageNaturalSize(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        if (w > 0 && h > 0) resolve({ w, h });
        else resolve(null);
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  /** Taille fichier en octets via en-tête (même origine : Content-Length lisible). */
  async function probeContentLengthBytes(url) {
    try {
      const r = await fetch(url, { method: 'HEAD', cache: 'default' });
      if (!r.ok) return null;
      const cl = r.headers.get('Content-Length');
      if (!cl) return null;
      const n = parseInt(cl, 10);
      if (Number.isNaN(n) || n <= 0) return null;
      return n;
    } catch {
      return null;
    }
  }

  async function probeRowImageFileMeta(row) {
    const url = row.thumbUrl;
    const tasks = [];
    if (isRasterImageRow(row)) {
      tasks.push(
        probeImageNaturalSize(url).then((dim) => {
          if (dim) row.probedDims = dim.w + ' × ' + dim.h + ' px';
        })
      );
    }
    tasks.push(
      probeContentLengthBytes(url).then((bytes) => {
        if (bytes != null) row.probedTailleMo = bytes / (1024 * 1024);
      })
    );
    await Promise.all(tasks);
  }

  /** Quand works.json est enrichi (dimensions + tailleMo), inutile de re-télécharger chaque fichier (HEAD + decode) : c’était le principal goulot d’étranglement. */
  function rowNeedsImageProbe(row) {
    const d = row.dimensions;
    const hasDims =
      d != null && String(d).trim() !== '' && String(d).trim() !== '—';
    const t = row.tailleMo;
    const hasMo = t != null && t !== '' && !Number.isNaN(Number(t));
    return !hasDims || !hasMo;
  }

  /** @param {Array<object>} rows */
  async function probeAllRowImages(rows) {
    const toProbe = rows.filter(rowNeedsImageProbe);
    if (toProbe.length === 0) return;

    let next = 0;
    const concurrency = 6;
    let probeRenderRaf = null;
    function scheduleProbeRender() {
      if (probeRenderRaf != null) return;
      probeRenderRaf = requestAnimationFrame(() => {
        probeRenderRaf = null;
        renderCatalogue({ resetPage: false });
      });
    }
    async function worker() {
      while (true) {
        const i = next++;
        if (i >= toProbe.length) break;
        try {
          await probeRowImageFileMeta(toProbe[i]);
        } catch (e) {
          console.warn('Sonde image catalogue', toProbe[i] && toProbe[i].thumbUrl, e);
        }
        scheduleProbeRender();
      }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  }

  function fileMoForRow(row) {
    if (row.probedTailleMo != null && !Number.isNaN(Number(row.probedTailleMo))) {
      return Number(row.probedTailleMo);
    }
    return row.tailleMo;
  }

  function dimensionsLabelForRow(row) {
    if (row.probedDims) return row.probedDims;
    const d = row.dimensions;
    if (d != null && String(d).trim() !== '' && String(d).trim() !== '—') return String(d).trim();
    return '—';
  }

  const container = document.getElementById('catalogue-root');
  const previewImg = document.getElementById('catalogue-preview-img');
  if (!container) return;

  /** @type {Array<object>} */
  let allRows = [];

  /** Filtré + trié (résultat filtres + tri). */
  let catalogueViewSorted = [];

  /** Page courante (1-based), pour la pagination. */
  let cataloguePage = 1;

  let paginationControlsBound = false;

  let sortColumn = 'order';
  let sortDir = 'asc';
  let editMode = false;
  let editCodes = DEFAULT_EDIT_CODES;
  let worksRawPayload = null;
  let activeEditRowIndex = -1;
  const dirtyWorksIds = new Set();

  /** @type {string[]} */
  let catalogSeriesOrder = [];
  /** @type {Record<string,string>} */
  let catalogSeriesNames = {};

  function stripAccentsSa(s) {
    return String(s)
      .normalize('NFD')
      .replace(/\p{M}/gu, '');
  }

  /** Code PHOTO dans le nom de fichier (aligné sur scripts/build-works-from-list.mjs). */
  function fileNameImpliesPhotoRedo(fileName) {
    let base = String(fileName).replace(/\.[^.]+$/i, '');
    base = base.replace(/^MS\d{4}[\s_-]+/i, '');
    const compact = stripAccentsSa(base).toUpperCase().replace(/\s+/g, '');
    if (compact.startsWith('PHOTO')) return true;
    const tokens = base.split(/[-_]+/).map((seg) =>
      stripAccentsSa(seg.trim())
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
    );
    if (tokens.includes('PHOTO')) return true;
    if (/(^|[^A-Z0-9])PHOTO([^A-Z0-9]|$)/.test(compact)) return true;
    return false;
  }

  function effectivePhoto(row) {
    const j = (row.photo || 'OK').trim();
    if (j === 'Redo' || fileNameImpliesPhotoRedo(row.fileName)) return 'Redo';
    const mo = fileMoForRow(row);
    if (mo != null && !Number.isNaN(Number(mo))) {
      const n = Number(mo);
      if (n >= 10) return 'HQ';
      if (n < 2) return 'LQ';
    }
    if (j === 'HQ') return 'HQ';
    return 'OK';
  }

  function photoCellLabel(row) {
    const e = effectivePhoto(row);
    if (e === 'Redo') return 'A refaire';
    if (e === 'HQ') return 'HQ';
    if (e === 'LQ') return 'LQ';
    return 'OK';
  }

  function buildRowsFromWorksData(data) {
    catalogSeriesOrder = data.seriesOrder || [];
    catalogSeriesNames = data.seriesNames || {};
    return data.works.map((w, i) => {
      const fp = w.media;
      const id = w.id || fp;
      const fileName = fp.includes('/') ? fp.slice(fp.indexOf('/') + 1) : fp;
      const lastDot = fileName.lastIndexOf('.');
      const ext = lastDot >= 0 ? fileName.slice(lastDot) : '';
      const codes = w.series || [];
      const seriesName =
        codes.length > 0
          ? codes.map((c) => catalogSeriesNames[c] || c).join(' · ')
          : 'non renseigné';
      const photo = w.photo || 'OK';
      const publish = w.publish || 'ON';
      const dimensions =
        w.dimensions != null && String(w.dimensions).trim() !== ''
          ? String(w.dimensions).trim()
          : '—';
      const tailleMo =
        w.tailleMo != null && w.tailleMo !== '' && !Number.isNaN(Number(w.tailleMo))
          ? Number(w.tailleMo)
          : null;
      const formatCode = w.format != null ? String(w.format).trim().toUpperCase() : '';
      const year = w.year != null && String(w.year).trim() !== '' ? String(w.year).trim() : '';
      const techniqueCode =
        w.technique != null ? String(w.technique).trim().toUpperCase() : '';
      const thumbUrl = MEDIA_BASE + fp;
      const thumbRelWebp = webThumbRelFromMediaFp(fp);
      const displayThumbUrl = thumbRelWebp ? MEDIA_BASE + thumbRelWebp : thumbUrl;
      return {
        id,
        filePath: fp,
        fileName,
        ext: ext || '—',
        seriesName,
        seriesCodes: codes,
        title: w.title || '',
        thumbUrl,
        displayThumbUrl,
        displayThumbSrc: encodeMediaPath(displayThumbUrl),
        fullImageSrc: encodeMediaPath(thumbUrl),
        orderIndex: i,
        photo,
        publish,
        dimensions,
        tailleMo,
        format: formatCode,
        year,
        technique: techniqueCode,
      };
    });
  }

  function msIdSortKey(id) {
    const m = /^MS(\d+)$/i.exec(String(id));
    return m ? parseInt(m[1], 10) : 0;
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

  function normalizeCodeEntries(entries) {
    if (!Array.isArray(entries)) return [];
    return entries
      .map((x) => {
        if (!x) return null;
        if (typeof x === 'string') return { code: x.trim().toUpperCase(), label: '' };
        const code = String(x.code || '').trim().toUpperCase();
        const label = String(x.label || '').trim();
        if (!code) return null;
        return { code, label };
      })
      .filter(Boolean);
  }

  async function loadEditCodes() {
    try {
      const r = await fetch(EDIT_CODES_URL, { cache: 'no-store' });
      if (!r.ok) return DEFAULT_EDIT_CODES;
      const j = await r.json();
      return {
        formats: normalizeCodeEntries(j.formats || DEFAULT_EDIT_CODES.formats),
        techniques: normalizeCodeEntries(j.techniques || DEFAULT_EDIT_CODES.techniques),
        series: normalizeCodeEntries(j.series || []),
      };
    } catch {
      return DEFAULT_EDIT_CODES;
    }
  }

  /** Encode chaque segment de chemin (espaces, accents) pour les attributs src/href. */
  function encodeMediaPath(url) {
    return String(url)
      .split('/')
      .map((seg, i) =>
        i === 0 ? seg : encodeURIComponent(String(seg).normalize('NFC'))
      )
      .join('/');
  }

  /**
   * Chemin logique miniature WebP (généré par scripts/generate-catalogue-thumbnails.mjs),
   * ou null si pas de miniature dédiée (hors catalogue/ ou non raster).
   */
  function webThumbRelFromMediaFp(mediaFp) {
    const fp = String(mediaFp || '')
      .trim()
      .replace(/\\/g, '/');
    if (!fp.toLowerCase().startsWith('catalogue/')) return null;
    const rest = fp.slice('catalogue/'.length);
    const lastSlash = rest.lastIndexOf('/');
    const filePart = lastSlash >= 0 ? rest.slice(lastSlash + 1) : rest;
    const lastDot = filePart.lastIndexOf('.');
    const ext = lastDot >= 0 ? filePart.slice(lastDot).toLowerCase() : '';
    if (!RASTER_IMAGE_EXT.has(ext)) return null;
    const stem = filePart.replace(/\.[^.]+$/i, '');
    const dirPart = lastSlash >= 0 ? rest.slice(0, lastSlash) : '';
    return dirPart
      ? 'catalogue/_thumbs/' + dirPart + '/' + stem + '.webp'
      : 'catalogue/_thumbs/' + stem + '.webp';
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

  function publishCellLabel(row) {
    const p = (row.publish || 'ON').trim().toUpperCase();
    if (p === 'OFF') return 'Non publié';
    if (p === 'VAL') return 'À valider';
    return 'Publié';
  }

  function getEtatSortKey(etatDisplay) {
    if (etatDisplay === 'P') return 0;
    if (etatDisplay === 'S') return 1;
    return 2;
  }

  function getSortValue(row, col) {
    switch (col) {
      case 'order':
        return row.orderIndex;
      case 'id':
        return msIdSortKey(row.id);
      case 'fileName':
        return row.fileName;
      case 'ext':
        return row.ext;
      case 'seriesName':
        return row.seriesName;
      case 'photo': {
        const e = effectivePhoto(row);
        const rank = { Redo: 0, LQ: 1, OK: 2, HQ: 3 };
        return rank[e] != null ? rank[e] : 2;
      }
      case 'dimensions':
        return dimensionsLabelForRow(row);
      case 'tailleMo':
        return fileMoForRow(row);
      case 'title':
        return row.title;
      case 'publish':
        return (row.publish || 'ON').trim().toUpperCase();
      case 'etat':
        return getEtatSortKey(row.etatDisplay);
      default:
        return row.orderIndex;
    }
  }

  function compareSort(a, b, col, dir) {
    const va = getSortValue(a, col);
    const vb = getSortValue(b, col);

    if (col === 'tailleMo') {
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
    const fs = document.getElementById('catalogue-filter-serie');
    const fph = document.getElementById('catalogue-filter-photo');
    const fe = document.getElementById('catalogue-filter-etat');
    const fpub = document.getElementById('catalogue-filter-publish');
    const serie = fs ? fs.value : '';
    const photo = fph ? fph.value : '';
    const etat = fe ? fe.value : '';
    const pub = fpub ? fpub.value : '';

    return rows.filter((r) => {
      if (serie === '__none_series__') {
        if (r.seriesCodes && r.seriesCodes.length) return false;
      } else if (serie && !(r.seriesCodes && r.seriesCodes.includes(serie))) return false;
      if (photo && effectivePhoto(r) !== photo) return false;
      if (pub && (r.publish || 'ON').trim().toUpperCase() !== pub) return false;
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
        renderCatalogue({ resetPage: true });
      });
    });
  }

  function getPageSizeFromSelect() {
    const sel = document.getElementById('catalogue-page-size');
    if (!sel) return 50;
    const v = String(sel.value || '50');
    if (v === 'all') return Infinity;
    const n = parseInt(v, 10);
    return Number.isNaN(n) || n < 1 ? 50 : n;
  }

  function updatePaginationBar(filteredTotal, totalPages, pageSize) {
    const bar = document.getElementById('catalogue-pagination');
    const prev = document.getElementById('catalogue-page-prev');
    const next = document.getElementById('catalogue-page-next');
    const label = document.getElementById('catalogue-page-label');
    if (!bar || !prev || !next || !label) return;

    const paginated =
      Number.isFinite(pageSize) && pageSize > 0 && filteredTotal > pageSize;
    bar.hidden = !paginated;
    prev.disabled = cataloguePage <= 1;
    next.disabled = cataloguePage >= totalPages;
    label.textContent = 'Page ' + cataloguePage + ' / ' + totalPages;
  }

  function bindPaginationControls() {
    if (paginationControlsBound) return;
    paginationControlsBound = true;

    document.getElementById('catalogue-page-prev')?.addEventListener('click', () => {
      if (cataloguePage > 1) {
        cataloguePage--;
        renderCatalogue({ resetPage: false });
        document.getElementById('catalogue-table-wrap')?.scrollIntoView({ block: 'nearest' });
      }
    });
    document.getElementById('catalogue-page-next')?.addEventListener('click', () => {
      const n = catalogueViewSorted.length;
      const ps = getPageSizeFromSelect();
      const totalPages =
        !Number.isFinite(ps) || ps <= 0 || n <= ps ? 1 : Math.max(1, Math.ceil(n / ps));
      if (cataloguePage < totalPages) {
        cataloguePage++;
        renderCatalogue({ resetPage: false });
        document.getElementById('catalogue-table-wrap')?.scrollIntoView({ block: 'nearest' });
      }
    });
    document.getElementById('catalogue-page-size')?.addEventListener('change', () => {
      renderCatalogue({ resetPage: true });
    });
  }

  function renderCatalogue(opts) {
    const o = opts || {};
    const resetPage = o.resetPage !== false;

    const tbody = document.getElementById('catalogue-tbody');
    if (!tbody) return;

    catalogueViewSorted = sortRows(filterRows(allRows));
    const sorted = catalogueViewSorted;
    const n = sorted.length;

    const pageSize = getPageSizeFromSelect();

    if (resetPage) cataloguePage = 1;

    const totalPages =
      !Number.isFinite(pageSize) || pageSize <= 0 || n <= pageSize
        ? 1
        : Math.max(1, Math.ceil(n / pageSize));

    if (cataloguePage > totalPages) cataloguePage = totalPages;
    if (cataloguePage < 1) cataloguePage = 1;

    const start =
      !Number.isFinite(pageSize) || pageSize <= 0 || n <= pageSize
        ? 0
        : (cataloguePage - 1) * pageSize;
    const slice =
      !Number.isFinite(pageSize) || pageSize <= 0 || n <= pageSize
        ? sorted
        : sorted.slice(start, Math.min(start + pageSize, n));

    tbody.innerHTML = slice.map(buildRowHtml).join('');

    const trs = tbody.querySelectorAll('tr');
    slice.forEach((r, i) => {
      const rowEl = trs[i];
      if (!rowEl) return;
      const thumb = rowEl.querySelector('.catalogue-thumb');
      if (thumb) attachPreview(thumb, r.fullImageSrc);
      const editBtn = rowEl.querySelector('.catalogue-row-edit-btn');
      if (editBtn) {
        editBtn.addEventListener('click', () => {
          const targetIndex = allRows.findIndex((x) => x.id === r.id);
          if (targetIndex >= 0) openEditDialog(targetIndex);
        });
      }
    });

    updateCount(slice.length, n);
    updatePaginationBar(n, totalPages, pageSize);
  }

  function fmtMo(v) {
    if (v == null || Number.isNaN(Number(v))) return '—';
    const n = Number(v);
    const t = n.toFixed(3).replace(/\.?0+$/, '');
    return t + ' Mo';
  }

  function buildRowHtml(r) {
    const etatDisplay = r.etatDisplay;
    return (
      '<tr title="' +
      escapeHtml(String(r.fileName || '') + (r.title ? ' — ' + r.title : '')) +
      '" data-id="' +
      escapeHtml(r.id) +
      '" data-path="' +
      escapeHtml(r.filePath) +
      '">' +
      '<td class="col-thumb catalogue-thumb-cell">' +
      '<img class="catalogue-thumb" src="' +
      escapeHtml(r.displayThumbSrc) +
      '" data-catalogue-full="' +
      escapeHtml(r.fullImageSrc) +
      '" alt="" loading="lazy" decoding="async" onerror="if(this.dataset.catalogueFull){this.onerror=null;this.src=this.dataset.catalogueFull}" />' +
      '</td>' +
      '<td><code>' +
      escapeHtml(r.id) +
      '</code></td>' +
      '<td>' +
      escapeHtml(r.fileName) +
      '</td>' +
      '<td>' +
      escapeHtml(r.ext) +
      '</td>' +
      '<td>' +
      escapeHtml(r.seriesName) +
      '</td>' +
      '<td>' +
      escapeHtml(photoCellLabel(r)) +
      '</td>' +
      '<td>' +
      escapeHtml(dimensionsLabelForRow(r)) +
      '</td>' +
      '<td>' +
      escapeHtml(fmtMo(fileMoForRow(r))) +
      '</td>' +
      '<td class="col-legende">' +
      escapeHtml(r.title) +
      '</td>' +
      '<td>' +
      escapeHtml(publishCellLabel(r)) +
      '</td>' +
      '<td>' +
      renderEtat(etatDisplay) +
      '</td>' +
      (editMode
        ? '<td class="catalogue-edit-col"><button type="button" class="catalogue-row-edit-btn">Edit</button></td>'
        : '') +
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
    const fs = document.getElementById('catalogue-filter-serie');
    const fph = document.getElementById('catalogue-filter-photo');
    const fpub = document.getElementById('catalogue-filter-publish');
    if (!fs || !fph || !fpub) return;

    const codesFromRows = new Set();
    allRows.forEach((r) => {
      (r.seriesCodes || []).forEach((c) => codesFromRows.add(c));
    });
    const seriesCodesOrdered = [
      ...catalogSeriesOrder.filter((c) => codesFromRows.has(c)),
      ...[...codesFromRows].filter((c) => !catalogSeriesOrder.includes(c)).sort((a, b) =>
        a.localeCompare(b, 'fr')
      ),
    ];

    fs.innerHTML = '';
    const optAllS = document.createElement('option');
    optAllS.value = '';
    optAllS.textContent = 'Toutes';
    fs.appendChild(optAllS);
    const optNoneS = document.createElement('option');
    optNoneS.value = '__none_series__';
    optNoneS.textContent = 'Non renseigné';
    fs.appendChild(optNoneS);
    seriesCodesOrdered.forEach((code) => {
      const o = document.createElement('option');
      o.value = code;
      o.textContent = catalogSeriesNames[code] || code;
      fs.appendChild(o);
    });

    fpub.innerHTML = '';
    const optAllPub = document.createElement('option');
    optAllPub.value = '';
    optAllPub.textContent = 'Tous';
    fpub.appendChild(optAllPub);
    [
      ['ON', 'Publié'],
      ['VAL', 'À valider'],
      ['OFF', 'Non publié'],
    ].forEach(([val, label]) => {
      const o = document.createElement('option');
      o.value = val;
      o.textContent = label;
      fpub.appendChild(o);
    });

    fph.innerHTML = '';
    const optAllPh = document.createElement('option');
    optAllPh.value = '';
    optAllPh.textContent = 'Toutes';
    fph.appendChild(optAllPh);
    [
      ['OK', 'OK'],
      ['LQ', 'LQ'],
      ['Redo', 'A refaire'],
      ['HQ', 'HQ'],
    ].forEach(([val, label]) => {
      const o = document.createElement('option');
      o.value = val;
      o.textContent = label;
      fph.appendChild(o);
    });
  }

  function bindFilterSelects() {
    [
      'catalogue-filter-serie',
      'catalogue-filter-photo',
      'catalogue-filter-publish',
      'catalogue-filter-etat',
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => renderCatalogue({ resetPage: true }));
    });
  }

  function ensureEditHeader() {
    const headRow = document.querySelector('#catalogue-thead tr');
    if (!headRow) return;
    const existing = headRow.querySelector('.catalogue-edit-col-head');
    if (editMode && !existing) {
      const th = document.createElement('th');
      th.className = 'catalogue-th catalogue-edit-col catalogue-edit-col-head';
      th.scope = 'col';
      th.textContent = 'Edition';
      headRow.appendChild(th);
      return;
    }
    if (!editMode && existing) existing.remove();
  }

  function updateEditExportButton() {
    const btn = document.getElementById('catalogue-edit-export');
    if (!btn) return;
    const n = dirtyWorksIds.size;
    btn.disabled = n === 0 || !worksRawPayload;
    btn.textContent = n > 0 ? `Telecharger works.json modifie (${n})` : 'Telecharger works.json modifie';
  }

  function getSeriesOptions() {
    const opts = new Map();
    (editCodes.series || []).forEach((x) => {
      opts.set(x.code, x.label || catalogSeriesNames[x.code] || x.code);
    });
    Object.keys(catalogSeriesNames).forEach((code) => {
      if (!opts.has(code)) opts.set(code, catalogSeriesNames[code] || code);
    });
    allRows.forEach((r) => {
      (r.seriesCodes || []).forEach((code) => {
        if (!opts.has(code)) opts.set(code, catalogSeriesNames[code] || code);
      });
    });
    return [...opts.entries()]
      .map(([code, label]) => ({ code, label }))
      .sort((a, b) => a.code.localeCompare(b.code, 'fr'));
  }

  function fillCodeSelect(selectEl, options, placeholder) {
    if (!selectEl) return;
    selectEl.innerHTML = '';
    const optEmpty = document.createElement('option');
    optEmpty.value = '';
    optEmpty.textContent = placeholder;
    selectEl.appendChild(optEmpty);
    options.forEach((x) => {
      const o = document.createElement('option');
      o.value = x.code;
      o.textContent = x.label ? `${x.code} — ${x.label}` : x.code;
      selectEl.appendChild(o);
    });
  }

  function renderSeriesPanel(selectedCodes) {
    const panel = document.getElementById('catalogue-edit-series-panel');
    if (!panel) return;
    const opts = getSeriesOptions();
    panel.innerHTML = '';
    opts.forEach((x) => {
      const label = document.createElement('label');
      label.className = 'catalogue-series-option';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = x.code;
      cb.checked = selectedCodes.includes(x.code);
      label.appendChild(cb);
      label.appendChild(document.createTextNode(x.label ? `${x.code} — ${x.label}` : x.code));
      panel.appendChild(label);
    });
  }

  function readSelectedSeriesCodes() {
    const panel = document.getElementById('catalogue-edit-series-panel');
    if (!panel) return [];
    return [...panel.querySelectorAll('input[type="checkbox"]:checked')]
      .map((el) => String(el.value || '').trim().toUpperCase())
      .filter(Boolean);
  }

  function updateSeriesToggleText() {
    const btn = document.getElementById('catalogue-edit-series-toggle');
    if (!btn) return;
    const selected = readSelectedSeriesCodes();
    btn.textContent = selected.length
      ? selected.join(', ')
      : 'Choisir...';
  }

  function closeEditDialog() {
    const dlg = document.getElementById('catalogue-edit-dialog');
    const backdrop = document.getElementById('catalogue-edit-backdrop');
    if (backdrop) backdrop.hidden = true;
    if (dlg && typeof dlg.close === 'function') dlg.close();
    activeEditRowIndex = -1;
    const err = document.getElementById('catalogue-edit-error');
    if (err) {
      err.hidden = true;
      err.textContent = '';
    }
  }

  function openEditDialog(rowIndex) {
    if (!editMode) return;
    const row = allRows[rowIndex];
    if (!row) return;
    activeEditRowIndex = rowIndex;
    const dlg = document.getElementById('catalogue-edit-dialog');
    const backdrop = document.getElementById('catalogue-edit-backdrop');
    const img = document.getElementById('catalogue-edit-image');
    const id = document.getElementById('catalogue-edit-id');
    const titleInput = document.getElementById('catalogue-edit-title-input');
    const yearInput = document.getElementById('catalogue-edit-year');
    const formatSel = document.getElementById('catalogue-edit-format');
    const techniqueSel = document.getElementById('catalogue-edit-technique');

    if (!dlg || !img || !id || !titleInput || !yearInput || !formatSel || !techniqueSel) return;

    img.src = row.fullImageSrc;
    id.textContent = `${row.id} — ${row.fileName}`;
    titleInput.value = row.title || '';
    yearInput.value = row.year || '';
    fillCodeSelect(formatSel, editCodes.formats || [], 'Aucun format');
    fillCodeSelect(techniqueSel, editCodes.techniques || [], 'Aucune technique');
    formatSel.value = row.format || '';
    techniqueSel.value = row.technique || '';

    renderSeriesPanel(row.seriesCodes || []);
    const panel = document.getElementById('catalogue-edit-series-panel');
    if (panel) panel.hidden = true;
    updateSeriesToggleText();
    if (backdrop) backdrop.hidden = false;
    if (typeof dlg.showModal === 'function') dlg.showModal();
  }

  function validateYear(v) {
    const t = String(v || '').trim();
    if (!t) return '';
    if (!/^\d{4}$/.test(t)) return null;
    return t;
  }

  function saveCurrentEdit() {
    if (activeEditRowIndex < 0) return;
    const row = allRows[activeEditRowIndex];
    if (!row) return;
    const err = document.getElementById('catalogue-edit-error');
    const titleInput = document.getElementById('catalogue-edit-title-input');
    const yearInput = document.getElementById('catalogue-edit-year');
    const formatSel = document.getElementById('catalogue-edit-format');
    const techniqueSel = document.getElementById('catalogue-edit-technique');
    if (!titleInput || !yearInput || !formatSel || !techniqueSel) return;

    const parsedYear = validateYear(yearInput.value);
    if (parsedYear == null) {
      if (err) {
        err.hidden = false;
        err.textContent = 'Annee invalide : saisir 4 chiffres (ex: 1987).';
      }
      return;
    }
    if (err) {
      err.hidden = true;
      err.textContent = '';
    }

    row.title = titleInput.value.trim();
    row.seriesCodes = readSelectedSeriesCodes();
    row.seriesName = row.seriesCodes.length
      ? row.seriesCodes.map((c) => catalogSeriesNames[c] || c).join(' · ')
      : 'non renseigné';
    row.format = String(formatSel.value || '').trim().toUpperCase();
    row.technique = String(techniqueSel.value || '').trim().toUpperCase();
    row.year = parsedYear;
    dirtyWorksIds.add(row.id);
    updateEditExportButton();
    closeEditDialog();
    renderCatalogue({ resetPage: false });
  }

  function buildUpdatedWorksPayload() {
    if (!worksRawPayload || !Array.isArray(worksRawPayload.works)) return null;
    const byId = new Map(allRows.map((r) => [r.id, r]));
    const nextWorks = worksRawPayload.works.map((w) => {
      const r = byId.get(w.id);
      if (!r) return w;
      const next = {
        ...w,
        title: r.title,
        series: r.seriesCodes || [],
      };
      if (r.format) next.format = r.format;
      else delete next.format;
      if (r.technique) next.technique = r.technique;
      else delete next.technique;
      if (r.year) next.year = r.year;
      else delete next.year;
      return next;
    });
    return { ...worksRawPayload, works: nextWorks };
  }

  function downloadUpdatedWorksJson() {
    const p = buildUpdatedWorksPayload();
    if (!p) return;
    const blob = new Blob([JSON.stringify(p, null, 2) + '\n'], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'works.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function setEditMode(nextMode) {
    editMode = !!nextMode;
    const toggle = document.getElementById('catalogue-edit-toggle');
    if (toggle) {
      toggle.setAttribute('aria-pressed', editMode ? 'true' : 'false');
      toggle.textContent = editMode ? 'Mode edition: ON' : 'Mode edition: OFF';
    }
    ensureEditHeader();
    renderCatalogue({ resetPage: false });
  }

  function bindEditControls() {
    const toggle = document.getElementById('catalogue-edit-toggle');
    const exportBtn = document.getElementById('catalogue-edit-export');
    const closeBtn = document.getElementById('catalogue-edit-close');
    const backdrop = document.getElementById('catalogue-edit-backdrop');
    const form = document.getElementById('catalogue-edit-form');
    const seriesToggle = document.getElementById('catalogue-edit-series-toggle');
    const seriesPanel = document.getElementById('catalogue-edit-series-panel');
    if (!toggle || !exportBtn || !form || !seriesToggle || !seriesPanel) return;

    toggle.addEventListener('click', () => {
      if (editMode) {
        setEditMode(false);
        sessionStorage.removeItem(EDIT_AUTH_KEY);
        closeEditDialog();
        return;
      }
      const pass = window.prompt('Mot de passe mode edition :');
      if (pass !== EDIT_PASS) {
        window.alert('Mot de passe invalide.');
        return;
      }
      sessionStorage.setItem(EDIT_AUTH_KEY, '1');
      setEditMode(true);
    });

    exportBtn.addEventListener('click', () => {
      downloadUpdatedWorksJson();
    });

    closeBtn?.addEventListener('click', closeEditDialog);
    backdrop?.addEventListener('click', closeEditDialog);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeEditDialog();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      saveCurrentEdit();
    });
    seriesToggle.addEventListener('click', () => {
      seriesPanel.hidden = !seriesPanel.hidden;
    });
    seriesPanel.addEventListener('change', () => updateSeriesToggleText());

    if (sessionStorage.getItem(EDIT_AUTH_KEY) === '1') setEditMode(true);
    updateEditExportButton();
  }

  function startCatalogue() {
    if (typeof WorksCatalog === 'undefined') {
      console.error('works-catalog.js doit être chargé avant catalogue.js');
      const ld = container && container.querySelector('.catalogue-loading');
      if (ld) {
        ld.className = 'catalogue-error';
        ld.textContent = 'Erreur : script works-catalog.js manquant.';
      }
      return;
    }

    Promise.all([
      WorksCatalog.load(),
      fetch(stateUrl)
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({})),
      fetch(WORKS_URL)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      loadEditCodes(),
    ])
      .then(([data, state, rawWorks, loadedCodes]) => {
        worksRawPayload = rawWorks;
        editCodes = loadedCodes || DEFAULT_EDIT_CODES;
        const baseRows = buildRowsFromWorksData(data);
        allRows = baseRows.map((r) => {
          const etatRaw = state[r.id] != null ? state[r.id] : state[r.filePath];
          const etatCode = normalizeEtat(etatRaw);
          const etatDisplay =
            etatCode === 'P' || etatCode === 'S' ? etatCode : null;
          return {
            ...r,
            etatDisplay,
          };
        });

        populateFilterSelects();
        bindFilterSelects();
        bindSortHeaders();
        updateSortHeaderUI();

        bindPaginationControls();
        bindEditControls();
        renderCatalogue();
        container.querySelector('.catalogue-loading')?.remove();
        void probeAllRowImages(allRows);
      })
      .catch((err) => {
        console.error(err);
        const ld = container && container.querySelector('.catalogue-loading');
        if (ld) {
          ld.className = 'catalogue-error';
          ld.textContent =
            'Erreur de chargement du catalogue. Ouvrez la page via un serveur HTTP local (works.json / titles.txt et images peuvent être bloqués en file://).';
        }
      });
  }

  startCatalogue();
})();
