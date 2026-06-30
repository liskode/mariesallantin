/**
 * Import d'œuvres : ajout (nouveaux MS####) ou mise à jour image (remplacement fichier).
 * Métadonnées (séries, année, technique, format, titre) extraites du nom de fichier en mode ajout.
 */
import fs from 'fs';
import path from 'path';
import { isFormatLikeCode, pickFormatCodeFromStem } from './parse-format-from-filename.mjs';

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
 * Découpe le nom (sans extension) en segments séparés par - ou _.
 */
function tokenizeImportStem(stem) {
  return String(stem || '')
    .trim()
    .split(/[-_]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function tokenLooksLikeTitle(tok) {
  if (/[a-zàâäéèêëïîôùûüç]/.test(tok)) return true;
  if (/\s/.test(tok) && tok.length > 5) return true;
  return false;
}

function matchSeriesToken(tok) {
  const u = String(tok || '').trim().toUpperCase();
  if (!/^[A-Z]{5}$/.test(u)) return null;
  return u;
}

function matchFormatToken(tok, knownFormats) {
  const u = String(tok || '').trim().toUpperCase();
  if (knownFormats?.has(u)) return u;
  if (isFormatLikeCode(u)) return u;
  return null;
}

function matchTechniqueToken(tok, knownTechniques) {
  const u = String(tok || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(u)) return null;
  return u;
}

/**
 * Extrait séries, année, technique, format et titre depuis le nom importé (mode ajout).
 * Les codes peuvent apparaître dans n'importe quel ordre avant le titre ; le titre
 * reprend la suite sans répéter les codes (ex. après LICOR_HOFO_1984_AST_…).
 */
export function parseImportMetadata(stem, opts = {}) {
  const { knownSeries, knownTechniques, knownFormats, workId } = opts;
  let s = String(stem || '').trim();
  const ms = extractMsIdFromStem(s);
  if (ms) s = s.slice(ms.length).replace(/^[-_]+/, '');

  const rawTokens = tokenizeImportStem(s);
  const seriesCodes = [];
  let year = null;
  let techniqueCode = null;
  let formatCode = null;
  let i = 0;

  while (i < rawTokens.length) {
    const tok = rawTokens[i];
    if (tokenLooksLikeTitle(tok)) break;
    const ser = matchSeriesToken(tok);
    if (!ser) break;
    if (!seriesCodes.includes(ser)) seriesCodes.push(ser);
    i++;
  }

  while (i < rawTokens.length) {
    const tok = rawTokens[i];
    if (tokenLooksLikeTitle(tok)) break;

    const upper = tok.toUpperCase();

    if (year == null && YEAR_RE.test(upper)) {
      year = parseInt(upper, 10);
      i++;
      continue;
    }

    if (formatCode == null) {
      const fmt = matchFormatToken(upper, knownFormats);
      if (fmt) {
        formatCode = fmt;
        i++;
        continue;
      }
    }

    if (techniqueCode == null) {
      const tech = matchTechniqueToken(upper, knownTechniques);
      if (tech) {
        techniqueCode = tech;
        i++;
        continue;
      }
    }

    const ser = matchSeriesToken(upper);
    if (ser && !seriesCodes.includes(ser)) {
      seriesCodes.push(ser);
      i++;
      continue;
    }

    break;
  }

  let title = rawTokens
    .slice(i)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!title) title = String(workId || '').toUpperCase() || 'Sans titre';

  const validFormat =
    formatCode && knownFormats?.has(formatCode)
      ? formatCode
      : (() => {
          const picked = pickFormatCodeFromStem(s);
          return picked && knownFormats?.has(picked) ? picked : null;
        })();
  const validTechnique =
    techniqueCode && knownTechniques?.has(techniqueCode) ? techniqueCode : null;

  return {
    seriesCodes,
    year,
    techniqueCode: validTechnique,
    formatCode: validFormat,
    parsedFormatCode: formatCode,
    parsedTechniqueCode: techniqueCode,
    title,
  };
}

/**
 * @param {ReturnType<typeof parseImportMetadata>} parsed
 * @param {{ knownSeries?: Set<string>, knownTechniques?: Set<string>, knownFormats?: Set<string> }} catalog
 * @returns {string[]}
 */
export function auditImportMetadata(parsed, catalog = {}) {
  const { knownSeries, knownTechniques, knownFormats } = catalog;
  const issues = [];
  for (const code of parsed.seriesCodes || []) {
    if (knownSeries?.size && !knownSeries.has(code)) {
      issues.push(`série inconnue : ${code}`);
    }
  }
  if (parsed.parsedFormatCode && !parsed.formatCode) {
    issues.push(`format inconnu : ${parsed.parsedFormatCode}`);
  }
  if (parsed.parsedTechniqueCode && !parsed.techniqueCode) {
    issues.push(`technique inconnue : ${parsed.parsedTechniqueCode}`);
  }
  return issues;
}

/**
 * @param {Array<{ originalName: string }>} files
 * @param {ImportMode} importMode
 * @param {Set<string>} existingIds ids déjà en base
 * @param {number} sequentialStart
 * @param {Set<string>} [catalog.knownSeries]
 * @param {Set<string>} [catalog.knownTechniques]
 * @param {Set<string>} [catalog.knownFormats]
 * @param {Set<string>} [catalog.knownPhotoStatuses]
 * @param {string | null} [catalog.photoStatusCode]
 */
export function planWorkImports(files, importMode, existingIds, sequentialStart, catalog = {}) {
  const {
    knownSeries = null,
    knownTechniques = null,
    knownFormats = null,
    knownPhotoStatuses = null,
    photoStatusCode = null,
  } = catalog;
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
      issues: [],
      seriesCodes: [],
      title: '',
      formatCode: null,
      techniqueCode: null,
      year: null,
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
        knownTechniques,
        knownFormats,
        workId: entry.workId,
      });
      entry.seriesCodes = parsed.seriesCodes;
      entry.title = parsed.title;
      entry.formatCode = parsed.formatCode;
      entry.techniqueCode = parsed.techniqueCode;
      entry.year = parsed.year;
      const issues = auditImportMetadata(parsed, {
        knownSeries,
        knownTechniques,
        knownFormats,
      });
      if (issues.length) {
        entry.issues = issues;
        entry.error = issues.join(' ; ');
      }
    }

    if (
      photoStatusCode &&
      knownPhotoStatuses?.size &&
      !knownPhotoStatuses.has(photoStatusCode)
    ) {
      const msg = `statut photo inconnu : ${photoStatusCode}`;
      entry.issues = [...(entry.issues || []), msg];
      entry.error = entry.error ? `${entry.error} ; ${msg}` : msg;
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
    photoStatusCode,
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
  const photoCode = photoStatusCode
    ? String(photoStatusCode).trim().toUpperCase()
    : null;

  const dbRow = {
    id: workId,
    title: parsed.title,
    filename_original: originalName,
    year: parsed.year,
    format_code: parsed.formatCode,
    technique_code: parsed.techniqueCode,
    publication_status_code: 'M',
    collector_code: null,
    width_cm: null,
    height_cm: null,
    sort_order: sortOrder,
    image_ext: imageExt === 'jpg' ? 'jpeg' : imageExt,
  };
  if (photoCode) dbRow.photo_status_code = photoCode;

  const jsonRow = {
    id: workId,
    media: mediaRel,
    title: parsed.title,
    series: [...parsed.seriesCodes],
    publish: 'VAL',
  };
  if (photoCode) jsonRow.photo = photoCode;

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

export function removeWorksJsonEntries(worksJsonPath, ids) {
  if (!Array.isArray(ids) || !ids.length) return 0;
  if (!fs.existsSync(worksJsonPath)) return 0;
  const data = JSON.parse(fs.readFileSync(worksJsonPath, 'utf8'));
  if (!Array.isArray(data.works)) return 0;
  const drop = new Set(ids.map((id) => String(id).trim().toUpperCase()).filter(Boolean));
  const before = data.works.length;
  data.works = data.works.filter((w) => !drop.has(String(w.id || '').toUpperCase()));
  fs.writeFileSync(worksJsonPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  return before - data.works.length;
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
