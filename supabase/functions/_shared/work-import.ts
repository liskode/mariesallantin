/** Logique d'import œuvres (plan + enregistrement Supabase, sans écriture fichiers). */

const MS_PREFIX_RE = /^(MS\d{4})/i;
const YEAR_RE = /^(19|20)\d{2}$/;
const RASTER_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.avif']);

export function extractMsIdFromFilename(filename: string): string | null {
  const name = String(filename || '').trim();
  const lastDot = name.lastIndexOf('.');
  const stem = lastDot === -1 ? name : name.slice(0, lastDot);
  const m = stem.match(MS_PREFIX_RE);
  return m ? m[1].toUpperCase() : null;
}

export function parseWorkIdNumber(id: string): number | null {
  const m = String(id || '').trim().toUpperCase().match(/^MS(\d{4})$/);
  return m ? parseInt(m[1], 10) : null;
}

export function formatWorkId(n: number): string {
  return `MS${String(n).padStart(4, '0')}`;
}

export function maxWorkIdNumber(ids: Iterable<string>): number {
  let max = 0;
  for (const id of ids) {
    const n = parseWorkIdNumber(id);
    if (n != null && n > max) max = n;
  }
  return max;
}

function isRasterFilename(filename: string): boolean {
  const name = String(filename || '').trim();
  const i = name.lastIndexOf('.');
  const ext = i >= 0 ? name.slice(i).toLowerCase() : '';
  return RASTER_EXT.has(ext);
}

function stemFromFilename(filename: string): string {
  const name = String(filename || '').trim();
  const lastDot = name.lastIndexOf('.');
  return lastDot === -1 ? name : name.slice(0, lastDot);
}

function extFromFilename(filename: string): string {
  const name = String(filename || '').trim();
  const lastDot = name.lastIndexOf('.');
  return lastDot === -1 ? '' : name.slice(lastDot + 1).toLowerCase();
}

export function resolveCatalogueBasename(
  originalName: string,
  workId: string,
  idMode: 'sequential' | 'from_filename'
): string {
  const name = String(originalName || '').trim();
  const lastDot = name.lastIndexOf('.');
  const stem = lastDot === -1 ? name : name.slice(0, lastDot);
  const ext = lastDot === -1 ? 'jpeg' : name.slice(lastDot + 1);
  if (idMode === 'from_filename') return name;
  const id = String(workId).toUpperCase();
  const existingMs = stem.match(MS_PREFIX_RE)?.[1]?.toUpperCase();
  let newStem = stem;
  if (existingMs) newStem = id + stem.slice(existingMs.length);
  else if (!stem.toUpperCase().startsWith(id)) newStem = stem ? `${id}_${stem}` : id;
  return `${newStem}.${ext}`;
}

export function planWorkImports(
  files: Array<{ originalName: string }>,
  idMode: 'sequential' | 'from_filename',
  reservedIds: Set<string>,
  sequentialStart: number
) {
  const items: Array<{
    originalName: string;
    workId: string;
    catalogueBasename: string;
    error: string | null;
  }> = [];
  const usedInPlan = new Set(reservedIds);
  let nextSeq = sequentialStart;

  for (const file of files) {
    const originalName = String(file.originalName || '').trim();
    const entry = { originalName, workId: '', catalogueBasename: '', error: null as string | null };
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
    let workId: string | null = null;
    if (idMode === 'from_filename') {
      workId = extractMsIdFromFilename(originalName);
      if (!workId) entry.error = 'aucun code MS#### au début du nom de fichier';
    } else {
      while (usedInPlan.has(formatWorkId(nextSeq))) nextSeq++;
      workId = formatWorkId(nextSeq);
      nextSeq++;
    }
    if (entry.error) {
      items.push(entry);
      continue;
    }
    if (!workId || usedInPlan.has(workId)) {
      entry.error = `code ${workId || '?'} déjà utilisé`;
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

function parseYearFromStem(stem: string): number | null {
  for (const tok of stem.toUpperCase().split(/[_\s-]+/).filter(Boolean)) {
    if (YEAR_RE.test(tok)) {
      const y = parseInt(tok, 10);
      if (y >= 1000 && y <= 9999) return y;
    }
  }
  return null;
}

function parseTechniqueFromStem(stem: string, knownTechniques: Set<string>): string | null {
  const parts = stem.toUpperCase().split(/[_\s-]+/).filter(Boolean);
  for (const tok of parts) {
    if (/^[A-Z]{3}$/.test(tok) && knownTechniques.has(tok)) return tok;
  }
  for (const tok of parts) {
    if (/^[A-Z]{3}$/.test(tok)) return tok;
  }
  return null;
}

function pickFormatCodeFromStem(stem: string): string | null {
  const parts = stem.toUpperCase().split(/[_\s-]+/).filter(Boolean);
  for (const tok of parts) {
    if (/^\d{3}[FPC]$/.test(tok) || /^HF\d{2}$/.test(tok) || /^HOFO$/.test(tok)) return tok;
  }
  return null;
}

export function titleFromStem(stem: string, workId: string): string {
  let t = String(stem || '').trim();
  const id = String(workId || '').toUpperCase();
  if (id && t.toUpperCase().startsWith(id)) t = t.slice(id.length).replace(/^[_\s.-]+/, '');
  t = t.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return t || id || 'Sans titre';
}

export function buildWorkRecords(opts: {
  workId: string;
  catalogueBasename: string;
  seriesCodes: string[];
  sortOrder: number;
  knownFormats: Set<string>;
  knownTechniques: Set<string>;
}) {
  const { workId, catalogueBasename, seriesCodes, sortOrder, knownFormats, knownTechniques } =
    opts;
  const stem = stemFromFilename(catalogueBasename);
  const formatCandidate = pickFormatCodeFromStem(stem);
  const formatCode =
    formatCandidate && knownFormats.has(formatCandidate) ? formatCandidate : null;
  const techniqueCandidate = parseTechniqueFromStem(stem, knownTechniques);
  const techniqueCode =
    techniqueCandidate && knownTechniques.has(techniqueCandidate) ? techniqueCandidate : null;
  const year = parseYearFromStem(stem);
  const title = titleFromStem(stem, workId);
  const imageExt = extFromFilename(catalogueBasename) || 'jpeg';

  return {
    dbRow: {
      id: workId,
      title,
      filename_original: catalogueBasename,
      year,
      format_code: formatCode,
      technique_code: techniqueCode,
      publication_status_code: 'M',
      photo_status_code: 'OK',
      collector_code: null,
      width_cm: null,
      height_cm: null,
      sort_order: sortOrder,
      image_ext: imageExt === 'jpg' ? 'jpeg' : imageExt,
    },
    seriesCodes: [...seriesCodes],
    mediaRel: `catalogue/${catalogueBasename}`,
  };
}

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

export async function fetchExistingWorkIds(supabase: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await supabase.from('works').select('id');
  if (error) throw error;
  return new Set((data || []).map((r) => String(r.id).toUpperCase()));
}

export async function fetchNextSortOrder(supabase: SupabaseClient): Promise<number> {
  const { data, error } = await supabase
    .from('works')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1);
  if (error) throw error;
  const max = data?.[0]?.sort_order;
  return Number.isFinite(Number(max)) ? Number(max) + 1 : 0;
}

export async function resolveNextSequentialStart(supabase: SupabaseClient): Promise<number> {
  const ids = await fetchExistingWorkIds(supabase);
  return maxWorkIdNumber(ids) + 1;
}

export async function persistWorksToSupabase(
  supabase: SupabaseClient,
  records: Array<{ dbRow: Record<string, unknown>; seriesCodes: string[] }>
) {
  for (const { dbRow, seriesCodes } of records) {
    const id = String(dbRow.id);
    const { error } = await supabase.from('works').upsert(dbRow, { onConflict: 'id' });
    if (error) throw error;
    await supabase.from('work_series').delete().eq('work_id', id);
    if (seriesCodes.length) {
      const payload = seriesCodes.map((code) => ({ work_id: id, series_code: code }));
      const { error: insErr } = await supabase.from('work_series').insert(payload);
      if (insErr) throw insErr;
    }
  }
}
