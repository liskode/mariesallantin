import {
  splitBasenameForEditor,
  rebuildFromEditorParts,
  extractSeriesCodesFromBase,
} from './legend-filename.mjs';

const AUTH_KEY = 'catalogue_ms75_ok';
const PASS = 'MS75';
const MEDIA_BASE = 'media/';
const WORKS_URL = MEDIA_BASE + 'works.json';

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

function workToState(w) {
  const fn = fileNameFromMedia(w.media);
  const split = splitBasenameForEditor(fn);
  const jp = w.publish != null ? String(w.publish).trim().toUpperCase() : '';
  const publish =
    jp === 'ON' || jp === 'OFF' || jp === 'VAL' ? jp : split.publish;
  const hasPhoto = split.hasPhoto || fileNameImpliesPhotoRedo(fn) || String(w.photo || '').trim() === 'Redo';
  const seriesCodes = (Array.isArray(w.series) ? w.series : []).map((x) => String(x).trim()).filter(Boolean);
  return {
    id: w.id,
    media: w.media,
    origBasename: fn,
    legend: split.legend,
    middleOpaque: split.middleOpaque,
    publish,
    hasPhoto,
    ext: split.ext,
    thumbUrl: MEDIA_BASE + w.media,
    seriesCodesStr: seriesCodes.join(', ') || '—',
    originalPhoto: w.photo,
    originalPublish: publish,
    cataloguePrefix: split.cataloguePrefix || '',
    fileSeparator: split.fileSeparator || '-',
  };
}

function recomputeBasename(st) {
  return rebuildFromEditorParts({
    cataloguePrefix: st.cataloguePrefix || '',
    fileSeparator: st.fileSeparator || '-',
    publish: st.publish,
    hasPhoto: st.hasPhoto,
    middleOpaque: st.middleOpaque,
    legend: st.legend,
    ext: st.ext,
  });
}

function rowIsDirty(st) {
  const nb = recomputeBasename(st);
  if (nb !== st.origBasename) return true;
  if (st.publish !== st.originalPublish) return true;
  const o = splitBasenameForEditor(st.origBasename);
  if (st.hasPhoto !== o.hasPhoto) return true;
  return false;
}

/** @type {ReturnType<typeof workToState>[]} */
let rows = [];
/** @type {object} */
let worksPayload = null;

function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function buildUpdatedPayload() {
  const works = worksPayload.works.map((w) => {
    const st = rows.find((r) => r.id === w.id);
    if (!st) return w;
    const newBasename = recomputeBasename(st);
    const newMedia = 'catalogue/' + newBasename;
    const baseNoExt = newBasename.replace(/\.(jpe?g|png|gif|webp|tiff?)$/i, '');
    const series = extractSeriesCodesFromBase(baseNoExt);
    let photo = w.photo;
    if (st.hasPhoto) photo = 'Redo';
    else if (String(w.photo || '').trim() === 'HQ') photo = 'HQ';
    else photo = 'OK';
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

function renderTable() {
  const tbody = document.getElementById('legend-editor-tbody');
  if (!tbody) return;
  tbody.innerHTML = rows
    .map((st, idx) => {
      const nb = recomputeBasename(st);
      const dirty = rowIsDirty(st);
      const rowClass = dirty ? 'legend-editor-row legend-editor-row--dirty' : 'legend-editor-row';
      return (
        `<tr class="${rowClass}" data-index="${idx}">` +
        `<td class="col-thumb catalogue-thumb-cell">` +
        `<button type="button" class="legend-thumb-btn" data-index="${idx}" aria-label="Agrandir la vignette">` +
        `<img class="catalogue-thumb" src="${escapeHtml(st.thumbUrl)}" alt="" loading="lazy" width="72" height="72" />` +
        `</button></td>` +
        `<td><code>${escapeHtml(st.id)}</code></td>` +
        `<td class="legend-codes"><code>${escapeHtml(st.seriesCodesStr)}</code></td>` +
        `<td><select class="legend-select legend-pub" data-index="${idx}" aria-label="Publication">` +
        `<option value="ON"${st.publish === 'ON' ? ' selected' : ''}>ON — publié</option>` +
        `<option value="VAL"${st.publish === 'VAL' ? ' selected' : ''}>VAL — à valider</option>` +
        `<option value="OFF"${st.publish === 'OFF' ? ' selected' : ''}>OFF — non publié</option>` +
        `</select></td>` +
        `<td><label class="legend-photo-label"><input type="checkbox" class="legend-photo" data-index="${idx}"${st.hasPhoto ? ' checked' : ''}/> PHOTO</label></td>` +
        `<td class="col-legende"><input type="text" class="legend-input" data-index="${idx}" value="${escapeHtml(st.legend)}" spellcheck="true" /></td>` +
        `<td><code class="legend-new-name${dirty ? ' legend-new-name--changed' : ''}">${escapeHtml(nb)}</code></td>` +
        `</tr>`
      );
    })
    .join('');

  tbody.querySelectorAll('.legend-input').forEach((el) => {
    el.addEventListener('input', () => {
      const i = Number(el.getAttribute('data-index'));
      rows[i].legend = el.value;
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
      rows[i].hasPhoto = el.checked;
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
  const nb = recomputeBasename(st);
  const dirty = rowIsDirty(st);
  tr.classList.toggle('legend-editor-row--dirty', dirty);
  const codeEl = tr.querySelector('.legend-new-name');
  if (codeEl) {
    codeEl.textContent = nb;
    codeEl.classList.toggle('legend-new-name--changed', dirty);
  }
  updateCount();
}

function updateCount() {
  const el = document.getElementById('legend-editor-count');
  if (!el) return;
  const n = rows.filter((st) => rowIsDirty(st)).length;
  el.innerHTML =
    n === 0
      ? '<strong>0</strong> ligne modifiée (fichier ou publication / PHOTO)'
      : `<strong>${n}</strong> ligne(s) modifiée(s) — exportez le JSON puis exécutez le script de renommage dans le dépôt.`;
}

function openZoom(index) {
  const st = rows[index];
  const backdrop = document.getElementById('legend-zoom-backdrop');
  const dialog = document.getElementById('legend-zoom-dialog');
  const img = document.getElementById('legend-zoom-img');
  if (!backdrop || !dialog || !img) return;
  img.src = st.thumbUrl;
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
    const r = await fetch(WORKS_URL, { cache: 'no-store' });
    if (!r.ok) throw new Error('works.json');
    worksPayload = await r.json();
    rows = (worksPayload.works || []).map(workToState);
    loading?.remove();
    renderTable();
    document.getElementById('legend-export-json')?.addEventListener('click', () => {
      const p = buildUpdatedPayload();
      downloadText('works.json', JSON.stringify(p, null, 2) + '\n', 'application/json');
    });
    document.getElementById('legend-export-sh')?.addEventListener('click', () => {
      downloadText('renames-catalogue.sh', buildRenameScript(), 'text/x-shellscript');
    });
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
