import {
  splitBasenameForEditor,
  rebuildFromEditorParts,
  extractSeriesCodesFromBase,
  extractSeriesCodesFromUnderscoreBody,
  stripCatalogueIdPrefix,
  splitUnderscoreCatalogueAfterMs,
  isUnderscoreMsCatalogueStem,
} from './legend-filename.mjs';

const AUTH_KEY = 'catalogue_ms75_ok';
const PASS = 'MS75';
const MEDIA_BASE = 'media/';
const WORKS_URL = MEDIA_BASE + 'works.json';
const CATALOG_STATE_URL = MEDIA_BASE + 'catalog-state.json';

const SAVE_API_BASE = (() => {
  const el = document.querySelector('meta[name="catalogue-save-api"]');
  const u = el && el.getAttribute('content');
  return String(u || '').trim() || 'http://127.0.0.1:47831';
})();

const RASTER_EXT_LEGEND = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.avif']);

function pathExtLowerFromFilePart(filePart) {
  const i = filePart.lastIndexOf('.');
  return i >= 0 ? filePart.slice(i).toLowerCase() : '';
}

/** @returns {string | null} ex. catalogue/_thumbs/foo.webp */
function webThumbRelFromMediaFp(mediaFp) {
  const fp = String(mediaFp || '')
    .trim()
    .replace(/\\/g, '/');
  if (!fp.toLowerCase().startsWith('catalogue/')) return null;
  const rest = fp.slice('catalogue/'.length);
  const lastSlash = rest.lastIndexOf('/');
  const filePart = lastSlash >= 0 ? rest.slice(lastSlash + 1) : rest;
  if (!RASTER_EXT_LEGEND.has(pathExtLowerFromFilePart(filePart))) return null;
  const stem = filePart.replace(/\.[^.]+$/i, '');
  const dirPart = lastSlash >= 0 ? rest.slice(0, lastSlash) : '';
  return dirPart
    ? `catalogue/_thumbs/${dirPart}/${stem}.webp`
    : `catalogue/_thumbs/${stem}.webp`;
}

function encodeMediaPath(url) {
  return String(url)
    .split('/')
    .map((seg, i) => (i === 0 ? seg : encodeURIComponent(seg)))
    .join('/');
}

function displayThumbSrcForMedia(media) {
  const rel = webThumbRelFromMediaFp(media);
  if (!rel) return encodeMediaPath(MEDIA_BASE + media);
  return encodeMediaPath(MEDIA_BASE + rel);
}

function fullImageSrcForMedia(media) {
  return encodeMediaPath(MEDIA_BASE + media);
}

function stripAccents(s) {
  return String(s)
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

function fileNameImpliesPhotoRedo(fileName) {
  let base = String(fileName).replace(/\.[^.]+$/i, '');
  base = base.replace(/^MS\d{4}[\s_-]+/i, '');
  const compact = stripAccents(base).toUpperCase().replace(/\s+/g, '');
  if (compact.startsWith('PHOTO')) return true;
  const tokens = base.split(/[-_]+/).map((seg) =>
    stripAccents(seg.trim())
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
  );
  if (tokens.includes('PHOTO')) return true;
  if (/(^|[^A-Z0-9])PHOTO([^A-Z0-9]|$)/.test(compact)) return true;
  return false;
}

function fileNameFromMedia(media) {
  const fp = String(media || '').trim();
  return fp.includes('/') ? fp.slice(fp.indexOf('/') + 1) : fp;
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function normalizeEtatCode(raw) {
  if (raw === 'W') return 'P';
  return raw;
}

/** @returns {'OK'|'HQ'|'Redo'} */
function derivePhotoStatus(w, fn, split) {
  const fromJson = String(w.photo || '').trim();
  if (fromJson === 'Redo' || split.hasPhoto || fileNameImpliesPhotoRedo(fn)) return 'Redo';
  if (fromJson === 'HQ') return 'HQ';
  return 'OK';
}

/** Une ligne = un code série (export works.json). */
function seriesArrayToText(arr) {
  return (Array.isArray(arr) ? arr : [])
    .map((x) => String(x).trim().toUpperCase())
    .filter(Boolean)
    .join('\n');
}

function seriesTextToCodes(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

function normalizeSeriesText(text) {
  return seriesTextToCodes(text).join('\n');
}

/** Texte initial colonne séries : JSON, sinon codes déduits du nom de fichier. */
function initialSeriesText(w, fn) {
  const fromJson = seriesArrayToText(w.series);
  if (fromJson) return fromJson;
  const lastDot = fn.lastIndexOf('.');
  const baseNoExt = lastDot >= 0 ? fn.slice(0, lastDot) : fn;
  const fromDash = extractSeriesCodesFromBase(baseNoExt);
  if (fromDash.length) return fromDash.join('\n');
  if (isUnderscoreMsCatalogueStem(baseNoExt)) {
    const afterMs = stripCatalogueIdPrefix(baseNoExt);
    const { bodySansLegend } = splitUnderscoreCatalogueAfterMs(afterMs);
    const fromUs = extractSeriesCodesFromUnderscoreBody(bodySansLegend);
    if (fromUs.length) return fromUs.join('\n');
  }
  return '';
}

function workToState(w, catalogState) {
  const fn = fileNameFromMedia(w.media);
  const split = splitBasenameForEditor(fn);
  const jp = w.publish != null ? String(w.publish).trim().toUpperCase() : '';
  const publish =
    jp === 'ON' || jp === 'OFF' || jp === 'VAL' ? jp : split.publish;
  const photoStatus = derivePhotoStatus(w, fn, split);
  const rawEtat = catalogState[w.id];
  const ne = normalizeEtatCode(rawEtat);
  const etat = ne === 'P' || ne === 'S' ? ne : '';
  const seriesText = initialSeriesText(w, fn);
  return {
    id: w.id,
    media: w.media,
    origBasename: fn,
    legend: split.legend,
    middleOpaque: split.middleOpaque,
    publish,
    photoStatus,
    etat,
    ext: split.ext,
    thumbUrl: MEDIA_BASE + w.media,
    seriesText,
    originalSeriesText: seriesText,
    originalPhotoStatus: photoStatus,
    originalPublish: publish,
    originalEtat: etat,
    cataloguePrefix: split.cataloguePrefix || '',
    fileSeparator: split.fileSeparator || '-',
  };
}

function recomputeBasename(st) {
  return rebuildFromEditorParts({
    cataloguePrefix: st.cataloguePrefix || '',
    fileSeparator: st.fileSeparator || '-',
    publish: st.publish,
    hasPhoto: st.photoStatus === 'Redo',
    middleOpaque: st.middleOpaque,
    legend: st.legend,
    ext: st.ext,
  });
}

function rowIsDirty(st) {
  const nb = recomputeBasename(st);
  if (nb !== st.origBasename) return true;
  if (st.publish !== st.originalPublish) return true;
  if (st.photoStatus !== st.originalPhotoStatus) return true;
  if (st.etat !== st.originalEtat) return true;
  if (normalizeSeriesText(st.seriesText) !== normalizeSeriesText(st.originalSeriesText)) return true;
  return false;
}

/** @type {ReturnType<typeof workToState>[]} */
let rows = [];
/** @type {object} */
let worksPayload = null;
/** @type {Record<string, string>} clone initial de catalog-state.json */
let catalogStateBase = {};
/** false si catalog-state.json n'a pas pu être lu (export état désactivé). */
let catalogStateFullyLoaded = false;

let saveApiAvailable = false;
let persistDebounce = null;
let persistRunning = false;
let exportButtonsBound = false;

function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function setPersistStatus(message, kind) {
  const el = document.getElementById('legend-persist-status');
  if (!el) return;
  el.textContent = message || '';
  el.classList.remove('legend-persist-status--ok', 'legend-persist-status--err', 'legend-persist-status--pending');
  if (kind === 'ok') el.classList.add('legend-persist-status--ok');
  else if (kind === 'err') el.classList.add('legend-persist-status--err');
  else if (kind === 'pending') el.classList.add('legend-persist-status--pending');
}

function updateThumbsInDom() {
  const tbody = document.getElementById('legend-editor-tbody');
  if (!tbody) return;
  rows.forEach((st, i) => {
    const tr = tbody.querySelector(`tr[data-index="${i}"]`);
    const img = tr && tr.querySelector('.catalogue-thumb');
    if (img) {
      const sep = st.thumbUrl.includes('?') ? '&' : '?';
      img.src = st.thumbUrl + sep + 'v=' + Date.now();
    }
  });
}

async function probeSaveApi() {
  saveApiAvailable = false;
  const hint = document.getElementById('legend-api-hint');
  try {
    const h = await fetch(`${SAVE_API_BASE}/api/health`, { cache: 'no-store' });
    const j = await h.json().catch(() => ({}));
    if (h.ok && j && j.ok === true) saveApiAvailable = true;
  } catch {
    /* API absente : téléchargements manuels */
  }
  if (hint) {
    hint.textContent = saveApiAvailable
      ? 'Les changements sont enregistrés automatiquement sur le disque. L’Id MS#### reste la référence ; le nom de fichier peut différer du titre affiché.'
      : 'Enregistrement disque : ouvrez un terminal à la racine du dépôt et lancez node scripts/catalogue-editor-api.mjs puis rechargez cette page.';
  }
}

function schedulePersist() {
  if (!saveApiAvailable) return;
  if (!rows.some((st) => rowIsDirty(st))) return;
  clearTimeout(persistDebounce);
  persistDebounce = setTimeout(() => void flushPersist(), 700);
}

async function flushPersist() {
  if (!saveApiAvailable || persistRunning) return;
  if (!rows.some((st) => rowIsDirty(st))) return;
  persistRunning = true;
  setPersistStatus('Enregistrement sur le disque…', 'pending');
  try {
    const renames = [];
    for (const st of rows) {
      const nb = recomputeBasename(st);
      if (nb !== st.origBasename) renames.push({ from: st.origBasename, to: nb });
    }
    const works = buildUpdatedPayload();
    const catalogState = catalogStateFullyLoaded ? buildUpdatedCatalogState() : null;
    const res = await fetch(`${SAVE_API_BASE}/api/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: PASS,
        works,
        catalogState: catalogState || undefined,
        renames,
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) throw new Error(j.error || res.statusText || 'échec enregistrement');

    for (const st of rows) {
      st.origBasename = recomputeBasename(st);
      st.media = 'catalogue/' + st.origBasename;
      st.thumbUrl = MEDIA_BASE + st.media;
      st.originalPublish = st.publish;
      st.originalPhotoStatus = st.photoStatus;
      st.originalEtat = st.etat;
      st.originalSeriesText = st.seriesText;
    }
    worksPayload = works;
    if (catalogStateFullyLoaded && catalogState) {
      catalogStateBase = { ...catalogState };
    }
    updateThumbsInDom();
    rows.forEach((_, i) => refreshRowPreview(i));
    setPersistStatus('Enregistré', 'ok');
  } catch (e) {
    console.error(e);
    setPersistStatus(String(e.message || e), 'err');
  } finally {
    persistRunning = false;
    if (saveApiAvailable && rows.some((st) => rowIsDirty(st))) schedulePersist();
  }
}

function buildUpdatedPayload() {
  const works = worksPayload.works.map((w) => {
    const st = rows.find((r) => r.id === w.id);
    if (!st) return w;
    const newBasename = recomputeBasename(st);
    const newMedia = 'catalogue/' + newBasename;
    const series = seriesTextToCodes(st.seriesText);
    let photo = 'OK';
    if (st.photoStatus === 'Redo') photo = 'Redo';
    else if (st.photoStatus === 'HQ') photo = 'HQ';
    return {
      ...w,
      media: newMedia,
      title: st.legend,
      publish: st.publish,
      photo,
      series,
    };
  });
  return { ...worksPayload, works };
}

function buildRenameScript() {
  const lines = ['#!/usr/bin/env sh', 'set -eu', 'ROOT="$(cd "$(dirname "$0")" && pwd)"', 'cd "$ROOT/media/catalogue"'];
  rows.forEach((st) => {
    const nb = recomputeBasename(st);
    if (nb === st.origBasename) return;
    const o = st.origBasename.replace(/'/g, "'\\''");
    const n = nb.replace(/'/g, "'\\''");
    lines.push(`if [ -f '${o}' ]; then mv -n '${o}' '${n}'; else echo "manquant: ${o}" >&2; fi`);
  });
  lines.push('');
  return lines.join('\n');
}

function buildUpdatedCatalogState() {
  if (!catalogStateFullyLoaded) return null;
  const out = { ...catalogStateBase };
  rows.forEach((st) => {
    if (!st.etat) delete out[st.id];
    else out[st.id] = st.etat;
  });
  return out;
}

function renderTable() {
  const tbody = document.getElementById('legend-editor-tbody');
  if (!tbody) return;
  tbody.innerHTML = rows
    .map((st, idx) => {
      const dirty = rowIsDirty(st);
      const rowClass = dirty ? 'legend-editor-row legend-editor-row--dirty' : 'legend-editor-row';
      return (
        `<tr class="${rowClass}" data-index="${idx}">` +
        `<td class="col-thumb catalogue-thumb-cell">` +
        `<div class="legend-thumb-stack">` +
        `<button type="button" class="legend-thumb-btn" data-index="${idx}" aria-label="Agrandir la vignette">` +
        `<img class="catalogue-thumb" src="${escapeHtml(displayThumbSrcForMedia(st.media))}" data-catalogue-full="${escapeHtml(fullImageSrcForMedia(st.media))}" alt="" loading="lazy" decoding="async" fetchpriority="low" width="72" height="72" onerror="if(this.dataset.catalogueFull){this.onerror=null;this.src=this.dataset.catalogueFull}" />` +
        `</button>` +
        `<div class="legend-thumb-id"><code>${escapeHtml(st.id)}</code></div>` +
        `</div></td>` +
        `<td class="col-legend-title">` +
        `<textarea class="legend-title-textarea" data-index="${idx}" rows="3" spellcheck="true">${escapeHtml(st.legend)}</textarea>` +
        `</td>` +
        `<td class="col-legend-series">` +
        `<textarea class="legend-series-textarea" data-index="${idx}" rows="6" spellcheck="false" aria-label="Codes série, un par ligne">${escapeHtml(st.seriesText)}</textarea>` +
        `</td>` +
        `<td class="col-legend-status">` +
        `<select class="legend-select legend-select--compact legend-photo" data-index="${idx}" aria-label="Statut photo">` +
        `<option value="OK"${st.photoStatus === 'OK' ? ' selected' : ''}>OK</option>` +
        `<option value="HQ"${st.photoStatus === 'HQ' ? ' selected' : ''}>HQ</option>` +
        `<option value="Redo"${st.photoStatus === 'Redo' ? ' selected' : ''}>Redo</option>` +
        `</select></td>` +
        `<td class="col-legend-status">` +
        `<select class="legend-select legend-select--compact legend-pub" data-index="${idx}" aria-label="Publication fichier">` +
        `<option value="ON"${st.publish === 'ON' ? ' selected' : ''}>ON</option>` +
        `<option value="VAL"${st.publish === 'VAL' ? ' selected' : ''}>VAL</option>` +
        `<option value="OFF"${st.publish === 'OFF' ? ' selected' : ''}>OFF</option>` +
        `</select></td>` +
        `<td class="col-legend-status">` +
        `<select class="legend-select legend-select--compact legend-etat" data-index="${idx}" aria-label="État sur le site public">` +
        `<option value=""${st.etat === '' ? ' selected' : ''}>—</option>` +
        `<option value="P"${st.etat === 'P' ? ' selected' : ''}>P</option>` +
        `<option value="S"${st.etat === 'S' ? ' selected' : ''}>S</option>` +
        `</select></td>` +
        `</tr>`
      );
    })
    .join('');

  tbody.querySelectorAll('.legend-title-textarea').forEach((el) => {
    el.addEventListener('input', () => {
      const i = Number(el.getAttribute('data-index'));
      rows[i].legend = el.value;
      refreshRowPreview(i);
    });
  });
  tbody.querySelectorAll('.legend-series-textarea').forEach((el) => {
    el.addEventListener('input', () => {
      const i = Number(el.getAttribute('data-index'));
      rows[i].seriesText = el.value;
      refreshRowPreview(i);
    });
  });
  tbody.querySelectorAll('.legend-pub').forEach((el) => {
    el.addEventListener('change', () => {
      const i = Number(el.getAttribute('data-index'));
      rows[i].publish = el.value;
      refreshRowPreview(i);
    });
  });
  tbody.querySelectorAll('.legend-photo').forEach((el) => {
    el.addEventListener('change', () => {
      const i = Number(el.getAttribute('data-index'));
      rows[i].photoStatus = /** @type {'OK'|'HQ'|'Redo'} */ (el.value);
      refreshRowPreview(i);
    });
  });
  tbody.querySelectorAll('.legend-etat').forEach((el) => {
    el.addEventListener('change', () => {
      const i = Number(el.getAttribute('data-index'));
      rows[i].etat = el.value;
      refreshRowPreview(i);
    });
  });
  tbody.querySelectorAll('.legend-thumb-btn').forEach((btn) => {
    btn.addEventListener('click', () => openZoom(Number(btn.getAttribute('data-index'))));
  });

  updateCount();
}

function refreshRowPreview(index) {
  const tbody = document.getElementById('legend-editor-tbody');
  if (!tbody) return;
  const tr = tbody.querySelector(`tr[data-index="${index}"]`);
  if (!tr) return;
  const st = rows[index];
  const dirty = rowIsDirty(st);
  tr.classList.toggle('legend-editor-row--dirty', dirty);
  updateCount();
  schedulePersist();
}

function updateCount() {
  const el = document.getElementById('legend-editor-count');
  if (!el) return;
  const n = rows.filter((st) => rowIsDirty(st)).length;
  if (saveApiAvailable) {
    el.innerHTML =
      n === 0
        ? '<strong>À jour</strong> — disque synchronisé'
        : `<strong>${n}</strong> modification(s) en attente d’enregistrement…`;
  } else {
    el.innerHTML =
      n === 0
        ? '<strong>0</strong> ligne modifiée'
        : `<strong>${n}</strong> ligne(s) modifiée(s) — téléchargez <code>works.json</code>, <code>catalog-state.json</code> si besoin, puis <code>renames-catalogue.sh</code> à la racine du dépôt.`;
  }
}

function openZoom(index) {
  const st = rows[index];
  const backdrop = document.getElementById('legend-zoom-backdrop');
  const dialog = document.getElementById('legend-zoom-dialog');
  const img = document.getElementById('legend-zoom-img');
  if (!backdrop || !dialog || !img) return;
  img.src = fullImageSrcForMedia(st.media);
  backdrop.hidden = false;
  dialog.hidden = false;
  backdrop.setAttribute('aria-hidden', 'false');
}

function closeZoom() {
  const backdrop = document.getElementById('legend-zoom-backdrop');
  const dialog = document.getElementById('legend-zoom-dialog');
  const img = document.getElementById('legend-zoom-img');
  if (backdrop) {
    backdrop.hidden = true;
    backdrop.setAttribute('aria-hidden', 'true');
  }
  if (dialog) dialog.hidden = true;
  if (img) img.removeAttribute('src');
}

function setupAuth() {
  const loginEl = document.getElementById('catalogue-login');
  const appEl = document.getElementById('catalogue-app');
  const form = document.getElementById('catalogue-login-form');
  const input = document.getElementById('catalogue-login-input');
  const errEl = document.getElementById('catalogue-login-error');

  function unlock() {
    sessionStorage.setItem(AUTH_KEY, '1');
    if (loginEl) loginEl.remove();
    if (appEl) appEl.hidden = false;
    loadWorks();
  }

  if (sessionStorage.getItem(AUTH_KEY) === '1') {
    if (loginEl) loginEl.remove();
    if (appEl) appEl.hidden = false;
    loadWorks();
    return;
  }

  if (appEl) appEl.hidden = true;
  input?.focus();

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (errEl) errEl.hidden = true;
    if (input && input.value === PASS) {
      unlock();
    } else {
      if (errEl) errEl.hidden = false;
      if (input) {
        input.value = '';
        input.focus();
      }
    }
  });
}

async function loadWorks() {
  const loading = document.getElementById('legend-editor-loading');
  try {
    const wr = await fetch(WORKS_URL, { cache: 'no-store' });
    if (!wr.ok) throw new Error('works.json');
    worksPayload = await wr.json();

    catalogStateFullyLoaded = false;
    catalogStateBase = {};
    let stateRes;
    try {
      stateRes = await fetch(CATALOG_STATE_URL, { cache: 'no-store' });
    } catch {
      stateRes = { ok: false };
    }
    if (stateRes && stateRes.ok) {
      try {
        const j = await stateRes.json();
        if (j && typeof j === 'object' && !Array.isArray(j)) {
          catalogStateBase = { ...j };
          catalogStateFullyLoaded = true;
        }
      } catch {
        catalogStateFullyLoaded = false;
      }
    }

    rows = (worksPayload.works || []).map((w) => workToState(w, catalogStateBase));
    await probeSaveApi();
    loading?.remove();
    renderTable();
    if (saveApiAvailable) setPersistStatus('Prêt — enregistrement auto', 'ok');

    const btnState = document.getElementById('legend-export-state');
    if (btnState) {
      btnState.disabled = !catalogStateFullyLoaded;
      btnState.title = catalogStateFullyLoaded
        ? ''
        : 'catalog-state.json non chargé — vérifiez le serveur HTTP local.';
    }

    if (!exportButtonsBound) {
      exportButtonsBound = true;
      document.getElementById('legend-export-json')?.addEventListener('click', () => {
        const p = buildUpdatedPayload();
        downloadText('works.json', JSON.stringify(p, null, 2) + '\n', 'application/json');
      });
      document.getElementById('legend-export-state')?.addEventListener('click', () => {
        if (!catalogStateFullyLoaded) {
          window.alert(
            "Impossible d'exporter catalog-state.json : le fichier n'a pas pu être chargé (servez le site en HTTP local)."
          );
          return;
        }
        const st = buildUpdatedCatalogState();
        if (!st) return;
        downloadText('catalog-state.json', JSON.stringify(st, null, 2) + '\n', 'application/json');
      });
      document.getElementById('legend-export-sh')?.addEventListener('click', () => {
        downloadText('renames-catalogue.sh', buildRenameScript(), 'text/x-shellscript');
      });
    }
  } catch (err) {
    console.error(err);
    if (loading) {
      loading.className = 'catalogue-error';
      loading.textContent =
        'Impossible de charger works.json. Servez le site en HTTP local (file:// bloque souvent les fetch).';
    }
  }
}

document.getElementById('legend-zoom-close')?.addEventListener('click', closeZoom);
document.getElementById('legend-zoom-backdrop')?.addEventListener('click', closeZoom);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeZoom();
});

setupAuth();
