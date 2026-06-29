/**
 * Import d'œuvres : ajout (nouveaux MS####) ou mise à jour image (remplacement fichier).
 * Métadonnées (séries, année, technique, format, titre) extraites du nom de fichier en mode ajout.
 */
import fs from 'fs';
import path from 'path';
import { pickFormatCodeFromStem } from './parse-format-from-filename.mjs';

const MS_PREFIX_RE = /^(MS\d{4})/i;
const YEAR_RE = /^(19|20)\d{2}$/;
const RASTER_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.avif']);

/** @typedef {'add' | 'update'} ImportMode */

export function normalizeImportMode(raw) {
  if (raw === 'update' || raw === 'from_filename') return 'update';
  return 'add';
}

export function extractMsIdFromStem(stem) {
  const m = String(stem || '').trim().match(MS_PREFIX_RE);
  return m ? m[1].toUpperCase() : null;
}

export function extractMsIdFromFilename(filename) {
  const name = String(filename || '').trim();
  const lastDot = name.lastIndexOf('.');
  const stem = lastDot === -1 ? name : name.slice(0, lastDot);
  return extractMsIdFromStem(stem);
}

export function parseWorkIdNumber(id) {
  const m = String(id || '').trim().toUpperCase().match(/^MS(\d{4})$/);
  return m ? parseInt(m[1], 10) : null;
}

export function formatWorkId(n) {
  return `MS${String(n).padStart(4, '0')}`;
}

/**
 * @param {Iterable<string>} ids
 * @returns {number}
 */
export function maxWorkIdNumber(ids) {
  let max = 0;
  for (const id of ids) {
    const n = parseWorkIdNumber(id);
    if (n != null && n > max) max = n;
  }
  return max;
}

/**
 * @param {string} worksJsonPath
 * @returns {Set<string>}
 */
export function loadWorksJsonIds(worksJsonPath) {
  const set = new Set();
  if (!fs.existsSync(worksJsonPath)) return set;
  try {
    const data = JSON.parse(fs.readFileSync(worksJsonPath, 'utf8'));
    for (const w of data.works || []) {
      if (w.id) set.add(String(w.id).toUpperCase());
    }
  } catch {
    /* ignore */
  }
  return set;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function fetchExistingWorkIds(supabase) {
  const { data, error } = await supabase.from('works').select('id');
  if (error) throw error;
  return new Set((data || []).map((r) => String(r.id).toUpperCase()));
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function fetchNextSortOrder(supabase) {
  const { data, error } = await supabase
    .from('works')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1);
  if (error) throw error;
  const max = data?.[0]?.sort_order;
  return Number.isFinite(Number(max)) ? Number(max) + 1 : 0;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} worksJsonPath
 */
export async function resolveNextSequentialStart(supabase, worksJsonPath) {
  const dbIds = await fetchExistingWorkIds(supabase);
  const jsonIds = loadWorksJsonIds(worksJsonPath);
  const all = [...dbIds, ...jsonIds];
  return maxWorkIdNumber(all) + 1;
}

function stemFromFilename(filename) {
  const name = String(filename || '').trim();
  const lastDot = name.lastIndexOf('.');
  return lastDot === -1 ? name : name.slice(0, lastDot);
}

function extFromFilename(filename) {
  const name = String(filename || '').trim();
  const lastDot = name.lastIndexOf('.');
  return lastDot === -1 ? '' : name.slice(lastDot + 1).toLowerCase();
}

function isRasterFilename(filename) {
  const ext = extFromFilename(filename);
  return RASTER_EXT.has('.' + ext.replace(/^\.?/, ''));
}

export function catalogueBasenameForWorkId(workId, originalName) {
  const ext = extFromFilename(originalName) || 'jpeg';
  return `${String(workId).toUpperCase()}.${ext}`;
}

/**
 * Sépare la partie codes (majuscules) du titre (dès la première minuscule).
 */
export function splitImportStem(stem) {
  const s = String(stem || '').trim();
  const m = s.match(/[a-z]/);
  if (m && m.index != null) {
    return {
      codePart: s.slice(0, m.index).replace(/[-_]+$/, ''),
      titlePart: s.slice(m.index).replace(/^[-_]+/, ''),
    };
  }
  return { codePart: s, titlePart: '' };
}

function codeTokensFromPart(codePart) {
  return String(codePart || '')
    .split(/[-_]+/)
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);
}

/**
 * Extrait séries, année, technique, format et titre depuis le nom importé (mode ajout).
 */
export function parseImportMetadata(stem, opts = {}) {
  const { knownSeries, knownTechniques, knownFormats, workId } = opts;
  let s = String(stem || '').trim();
  const ms = extractMsIdFromStem(s);
  if (ms) s = s.slice(ms.length).replace(/^[-_]+/, '');

  const { codePart, titlePart } = splitImportStem(s);
  const tokens = codeTokensFromPart(codePart);
  const seriesCodes = [];
  let i = 0;

  while (i < tokens.length) {
    const tok = tokens[i];
    if (!/^[A-Z]{5}$/.test(tok)) break;
    if (knownSeries?.size && !knownSeries.has(tok)) break;
    if (!seriesCodes.includes(tok)) seriesCodes.push(tok);
    i++;
  }

  let year = null;
  if (i < tokens.length && YEAR_RE.test(tokens[i])) {
    year = parseInt(tokens[i], 10);
    i++;
  }

  let technique = null;
  if (i < tokens.length && /^[A-Z]{3}$/.test(tokens[i])) {
    const tok = tokens[i];
    if (!knownTechniques?.size || knownTechniques.has(tok)) technique = tok;
    else technique = tok;
    i++;
  }

  let format = null;
  if (i < tokens.length) {
    const tok = tokens[i];
    const fromKnown = knownFormats?.has(tok);
    const fromStem = pickFormatCodeFromStem(codePart);
    if (fromKnown || tok === fromStem || /^\d{3}[FPC]$/.test(tok) || /^HF\d{2}$/.test(tok)) {
      format = fromKnown ? tok : fromStem || tok;
      i++;
    }
  }

  let title = titlePart.replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!title && i < tokens.length) {
    title = tokens
      .slice(i)
      .join(' ')
      .replace(/_/g, ' ')
      .trim();
  }
  if (!title) title = String(workId || '').toUpperCase() || 'Sans titre';

  const formatCode =
    format && knownFormats?.has(format) ? format : pickFormatCodeFromStem(codePart);
  const validFormat = formatCode && knownFormats?.has(formatCode) ? formatCode : null;
  const validTechnique =
    technique && knownTechniques?.has(technique) ? technique : null;

  return {
    seriesCodes,
    year,
    techniqueCode: validTechnique,
    formatCode: validFormat,
    title,
  };
}

/**
 * @param {Array<{ originalName: string }>} files
 * @param {ImportMode} importMode
 * @param {Set<string>} existingIds ids déjà en base
 * @param {number} sequentialStart
 * @param {Set<string>} [knownSeries]
 */
export function planWorkImports(files, importMode, existingIds, sequentialStart, knownSeries = null) {
  const items = [];
  const batchAddIds = new Set();
  const batchUpdateIds = new Set();
  let nextSeq = sequentialStart;

  for (const file of files) {
    const originalName = String(file.originalName || '').trim();
    const entry = {
      originalName,
      workId: '',
      catalogueBasename: '',
      importMode,
      effectiveMode: importMode,
      warning: null,
      error: null,
      seriesCodes: [],
      title: '',
    };

    if (!originalName) {
      entry.error = 'nom de fichier manquant';
      items.push(entry);
      continue;
    }
    if (!isRasterFilename(originalName)) {
      entry.error = 'format image non pris en charge';
      items.push(entry);
      continue;
    }

    if (importMode === 'update') {
      const workId = extractMsIdFromFilename(originalName);
      if (!workId) {
        entry.error = 'le nom doit commencer par MS#### (ex. MS0300.jpeg)';
        items.push(entry);
        continue;
      }
      if (!existingIds.has(workId)) {
        entry.warning = `${workId} inconnu — sera traité en ajout`;
        entry.effectiveMode = 'add';
        while (existingIds.has(formatWorkId(nextSeq)) || batchAddIds.has(formatWorkId(nextSeq))) {
          nextSeq++;
        }
        entry.workId = formatWorkId(nextSeq);
        nextSeq++;
      } else {
        entry.workId = workId;
        if (batchUpdateIds.has(workId)) {
          entry.error = `code ${workId} en double dans ce lot`;
          items.push(entry);
          continue;
        }
        batchUpdateIds.add(workId);
      }
    } else {
      while (existingIds.has(formatWorkId(nextSeq)) || batchAddIds.has(formatWorkId(nextSeq))) {
        nextSeq++;
      }
      entry.workId = formatWorkId(nextSeq);
      nextSeq++;
    }

    if (entry.effectiveMode === 'add') {
      if (batchAddIds.has(entry.workId)) {
        entry.error = `code ${entry.workId} en double dans ce lot`;
        items.push(entry);
        continue;
      }
      batchAddIds.add(entry.workId);
    }

    entry.catalogueBasename = catalogueBasenameForWorkId(entry.workId, originalName);

    if (entry.effectiveMode === 'add') {
      const parsed = parseImportMetadata(stemFromFilename(originalName), {
        knownSeries,
        workId: entry.workId,
      });
      entry.seriesCodes = parsed.seriesCodes;
      entry.title = parsed.title;
    }

    items.push(entry);
  }

  return items;
}

/**
 * @param {object} opts
 */
export function buildWorkRecords(opts) {
  const {
    workId,
    originalName,
    sortOrder,
    knownFormats,
    knownTechniques,
    knownSeries,
  } = opts;
  const catalogueBasename = catalogueBasenameForWorkId(workId, originalName);
  const parsed = parseImportMetadata(stemFromFilename(originalName), {
    knownSeries,
    knownTechniques,
    knownFormats,
    workId,
  });
  const imageExt = extFromFilename(originalName) || 'jpeg';
  const mediaRel = `catalogue/${catalogueBasename}`;

  const dbRow = {
    id: workId,
    title: parsed.title,
    filename_original: originalName,
    year: parsed.year,
    format_code: parsed.formatCode,
    technique_code: parsed.techniqueCode,
    publication_status_code: 'M',
    photo_status_code: 'OK',
    collector_code: null,
    width_cm: null,
    height_cm: null,
    sort_order: sortOrder,
    image_ext: imageExt === 'jpg' ? 'jpeg' : imageExt,
  };

  const jsonRow = {
    id: workId,
    media: mediaRel,
    title: parsed.title,
    series: [...parsed.seriesCodes],
    photo: 'OK',
    publish: 'VAL',
  };

  return {
    dbRow,
    jsonRow,
    seriesCodes: [...parsed.seriesCodes],
    mediaRel,
  };
}

/**
 * Mise à jour image uniquement (pas titre, séries, etc.).
 */
export function buildWorkImageUpdate(opts) {
  const { workId, originalName, fileSizeBytes } = opts;
  const catalogueBasename = catalogueBasenameForWorkId(workId, originalName);
  const imageExt = extFromFilename(originalName) || 'jpeg';
  return {
    dbPatch: {
      image_ext: imageExt === 'jpg' ? 'jpeg' : imageExt,
      file_size_bytes: fileSizeBytes ?? null,
      updated_at: new Date().toISOString(),
    },
    catalogueBasename,
    mediaRel: `catalogue/${catalogueBasename}`,
  };
}

export function appendWorksJsonEntries(worksJsonPath, newEntries) {
  let data = { version: 2, works: [] };
  if (fs.existsSync(worksJsonPath)) {
    data = JSON.parse(fs.readFileSync(worksJsonPath, 'utf8'));
  }
  if (!Array.isArray(data.works)) data.works = [];
  const existing = new Set(data.works.map((w) => String(w.id).toUpperCase()));
  for (const entry of newEntries) {
    if (existing.has(entry.id)) {
      const idx = data.works.findIndex((w) => String(w.id).toUpperCase() === entry.id);
      if (idx >= 0) data.works[idx] = { ...data.works[idx], ...entry };
      else data.works.push(entry);
    } else {
      data.works.push(entry);
      existing.add(entry.id);
    }
  }
  fs.writeFileSync(worksJsonPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

export async function writeCatalogueFile(catalogueDir, basename, buffer) {
  const safe = path.basename(String(basename || ''));
  if (!safe || safe.includes('..')) throw new Error('nom de fichier invalide');
  await fs.promises.mkdir(catalogueDir, { recursive: true });
  const dest = path.join(catalogueDir, safe);
  await fs.promises.writeFile(dest, buffer);
  return dest;
}

/**
 * Archive l'ancienne image avant remplacement (media/Archive/MS0023_old.ext, _old2, …).
 * @returns {string | null} chemin archive
 */
export async function archiveExistingCatalogueFile(catalogueDir, archiveDir, basename) {
  const safe = path.basename(String(basename || ''));
  if (!safe || safe.includes('..')) return null;
  const src = path.join(catalogueDir, safe);
  if (!fs.existsSync(src)) return null;
  await fs.promises.mkdir(archiveDir, { recursive: true });
  const ext = path.extname(safe);
  const stem = path.basename(safe, ext);
  let dest = path.join(archiveDir, `${stem}_old${ext}`);
  let n = 2;
  while (fs.existsSync(dest)) {
    dest = path.join(archiveDir, `${stem}_old${n}${ext}`);
    n++;
  }
  await fs.promises.rename(src, dest);
  return dest;
}

/** @returns {string | null} chemin absolu miniature */
function thumbAbsForMedia(mediaRoot, mediaRel) {
  const m = String(mediaRel || '').trim().replace(/\\/g, '/');
  if (!m.toLowerCase().startsWith('catalogue/')) return null;
  const rest = m.slice('catalogue/'.length);
  const lastSlash = rest.lastIndexOf('/');
  const filePart = lastSlash >= 0 ? rest.slice(lastSlash + 1) : rest;
  if (!RASTER_EXT.has(path.extname(filePart).toLowerCase())) return null;
  const stem = filePart.replace(/\.[^.]+$/i, '');
  const dirPart = lastSlash >= 0 ? rest.slice(0, lastSlash) : '';
  const relThumb = dirPart ? `${dirPart}/${stem}.webp` : `${stem}.webp`;
  return path.join(mediaRoot, 'catalogue', '_thumbs', relThumb);
}

export async function generateThumbnailForMedia(mediaRoot, mediaRel) {
  let Sharp;
  try {
    const mod = await import('sharp');
    Sharp = mod.default;
  } catch {
    return { ok: false, skipped: 'sharp indisponible' };
  }
  const srcAbs = path.join(mediaRoot, ...String(mediaRel).split('/'));
  const dstAbs = thumbAbsForMedia(mediaRoot, mediaRel);
  if (!dstAbs || !fs.existsSync(srcAbs)) return { ok: false, skipped: 'source absente' };
  await fs.promises.mkdir(path.dirname(dstAbs), { recursive: true });
  await Sharp(srcAbs)
    .rotate()
    .resize({ width: 320, height: 320, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82, effort: 4 })
    .toFile(dstAbs);
  return { ok: true };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Array<{ dbRow: object, seriesCodes: string[] }>} records
 */
export async function persistWorksToSupabase(supabase, records) {
  for (const { dbRow, seriesCodes } of records) {
    const { error } = await supabase.from('works').upsert(dbRow, { onConflict: 'id' });
    if (error) throw error;
    await supabase.from('work_series').delete().eq('work_id', dbRow.id);
    if (seriesCodes.length) {
      const payload = seriesCodes.map((code) => ({
        work_id: dbRow.id,
        series_code: code,
      }));
      const { error: insErr } = await supabase.from('work_series').insert(payload);
      if (insErr) throw insErr;
    }
  }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Array<{ workId: string, dbPatch: object }>} updates
 */
export async function persistWorkImageUpdatesToSupabase(supabase, updates) {
  for (const { workId, dbPatch } of updates) {
    const { error } = await supabase.from('works').update(dbPatch).eq('id', workId);
    if (error) throw error;
  }
}
