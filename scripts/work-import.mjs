/**
 * Import de nouvelles œuvres : attribution d'id MS####, fichiers catalogue, Supabase, works.json.
 */
import fs from 'fs';
import path from 'path';
import { parseFormatFromBasename } from './parse-format-from-filename.mjs';

const MS_ID_RE = /^MS\d{4}$/i;
const MS_PREFIX_RE = /^(MS\d{4})/i;
const YEAR_RE = /^(19|20)\d{2}$/;
const RASTER_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.avif']);

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

function parseYearFromStem(stem) {
  const parts = stem.toUpperCase().split(/[_\s-]+/).filter(Boolean);
  for (const tok of parts) {
    if (YEAR_RE.test(tok)) {
      const y = parseInt(tok, 10);
      if (y >= 1000 && y <= 9999) return y;
    }
  }
  return null;
}

function parseTechniqueFromStem(stem, knownTechniques) {
  const parts = stem.toUpperCase().split(/[_\s-]+/).filter(Boolean);
  for (const tok of parts) {
    if (/^[A-Z]{3}$/.test(tok) && knownTechniques?.has(tok)) return tok;
  }
  for (const tok of parts) {
    if (/^[A-Z]{3}$/.test(tok)) return tok;
  }
  return null;
}

export function titleFromStem(stem, workId) {
  let t = String(stem || '').trim();
  const id = String(workId || '').toUpperCase();
  if (id && t.toUpperCase().startsWith(id)) {
    t = t.slice(id.length).replace(/^[_\s.-]+/, '');
  }
  t = t.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return t || id || 'Sans titre';
}

/**
 * Nom de fichier catalogue final pour un id attribué.
 */
export function resolveCatalogueBasename(originalName, workId, idMode) {
  const name = String(originalName || '').trim();
  const lastDot = name.lastIndexOf('.');
  const stem = lastDot === -1 ? name : name.slice(0, lastDot);
  const ext = lastDot === -1 ? 'jpeg' : name.slice(lastDot + 1);

  if (idMode === 'from_filename') {
    return name;
  }

  const id = String(workId).toUpperCase();
  let newStem = stem;
  const existingMs = extractMsIdFromStem(stem);
  if (existingMs) {
    newStem = id + stem.slice(existingMs.length);
  } else if (!stem.toUpperCase().startsWith(id)) {
    newStem = stem ? `${id}_${stem}` : id;
  } else {
    newStem = stem;
  }
  return `${newStem}.${ext}`;
}

/**
 * @param {Array<{ originalName: string }>} files
 * @param {'sequential' | 'from_filename'} idMode
 * @param {Set<string>} reservedIds ids déjà pris (db + json + plan en cours)
 * @param {number} sequentialStart
 */
export function planWorkImports(files, idMode, reservedIds, sequentialStart) {
  const items = [];
  const usedInPlan = new Set(reservedIds);
  let nextSeq = sequentialStart;

  for (const file of files) {
    const originalName = String(file.originalName || '').trim();
    const entry = {
      originalName,
      workId: '',
      catalogueBasename: '',
      error: null,
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

    let workId = null;
    if (idMode === 'from_filename') {
      workId = extractMsIdFromFilename(originalName);
      if (!workId) {
        entry.error = 'aucun code MS#### au début du nom de fichier';
        items.push(entry);
        continue;
      }
    } else {
      while (usedInPlan.has(formatWorkId(nextSeq))) nextSeq++;
      workId = formatWorkId(nextSeq);
      nextSeq++;
    }

    if (usedInPlan.has(workId)) {
      entry.error = `code ${workId} déjà utilisé`;
      items.push(entry);
      continue;
    }

    usedInPlan.add(workId);
    entry.workId = workId;
    entry.catalogueBasename = resolveCatalogueBasename(originalName, workId, idMode);
    items.push(entry);
  }

  return items;
}

/**
 * @param {object} opts
 * @param {string} opts.workId
 * @param {string} opts.catalogueBasename
 * @param {string[]} opts.seriesCodes
 * @param {number} opts.sortOrder
 * @param {Set<string>} knownFormats
 * @param {Set<string>} knownTechniques
 */
export function buildWorkRecords(opts) {
  const { workId, catalogueBasename, seriesCodes, sortOrder, knownFormats, knownTechniques } =
    opts;
  const stem = stemFromFilename(catalogueBasename);
  const parsed = parseFormatFromBasename(catalogueBasename);
  const formatCode =
    parsed.formatCode && knownFormats.has(parsed.formatCode) ? parsed.formatCode : null;
  const techniqueCode = parseTechniqueFromStem(stem, knownTechniques);
  const validTechnique =
    techniqueCode && knownTechniques.has(techniqueCode) ? techniqueCode : null;
  const year = parseYearFromStem(stem);
  const title = titleFromStem(stem, workId);
  const mediaRel = `catalogue/${catalogueBasename}`;
  const imageExt = parsed.imageExt || extFromFilename(catalogueBasename) || 'jpeg';

  const dbRow = {
    id: workId,
    title,
    filename_original: catalogueBasename,
    year,
    format_code: formatCode,
    technique_code: validTechnique,
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
    title,
    series: [...seriesCodes],
    photo: 'OK',
    publish: 'VAL',
  };

  return { dbRow, jsonRow, seriesCodes: [...seriesCodes], mediaRel };
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
