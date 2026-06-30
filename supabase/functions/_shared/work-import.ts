/** Logique d'import œuvres (plan + enregistrement Supabase, sans écriture fichiers). */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

const MS_PREFIX_RE = /^(MS\d{4})/i;
const YEAR_RE = /^(19|20)\d{2}$/;
const RASTER_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.avif']);

export type ImportMode = 'add' | 'update';

export function normalizeImportMode(raw: string): ImportMode {
  if (raw === 'update' || raw === 'from_filename') return 'update';
  return 'add';
}

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

export function catalogueBasenameForWorkId(workId: string, originalName: string): string {
  const ext = extFromFilename(originalName) || 'jpeg';
  return `${String(workId).toUpperCase()}.${ext}`;
}

function tokenizeImportStem(stem: string): string[] {
  return String(stem || '')
    .trim()
    .split(/[-_]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function tokenLooksLikeTitle(tok: string): boolean {
  if (/[a-zàâäéèêëïîôùûüç]/.test(tok)) return true;
  if (/\s/.test(tok) && tok.length > 5) return true;
  return false;
}

function matchSeriesToken(tok: string): string | null {
  const u = String(tok || '').trim().toUpperCase();
  if (!/^[A-Z]{5}$/.test(u)) return null;
  return u;
}

function isFormatLikeCode(code: string): boolean {
  return (
    /^\d{3}[FP]$/.test(code) ||
    /^\d{3}C$/.test(code) ||
    /^HF\d{2}$/.test(code) ||
    /^HOFO$/.test(code) ||
    /^0HF0$/.test(code) ||
    /^0[A-Z0-9]{3}$/.test(code) ||
    /^\d{4}$/.test(code)
  );
}

function matchFormatToken(tok: string, knownFormats: Set<string>): string | null {
  const u = String(tok || '').trim().toUpperCase();
  if (knownFormats.has(u)) return u;
  if (isFormatLikeCode(u)) return u;
  return null;
}

function matchTechniqueToken(tok: string): string | null {
  const u = String(tok || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(u)) return null;
  return u;
}

function pickFormatCodeFromStem(stem: string): string | null {
  const parts = stem.toUpperCase().split(/[_\s-]+/).filter(Boolean);
  for (const tok of parts) {
    if (isFormatLikeCode(tok)) return tok;
  }
  return null;
}

export function parseImportMetadata(
  stem: string,
  opts: {
    knownSeries?: Set<string>;
    knownTechniques?: Set<string>;
    knownFormats?: Set<string>;
    workId?: string;
  } = {}
) {
  const { knownSeries, knownTechniques, knownFormats, workId } = opts;
  let s = String(stem || '').trim();
  const ms = s.match(MS_PREFIX_RE)?.[1]?.toUpperCase();
  if (ms) s = s.slice(ms.length).replace(/^[-_]+/, '');

  const rawTokens = tokenizeImportStem(s);
  const seriesCodes: string[] = [];
  let year: number | null = null;
  let techniqueCode: string | null = null;
  let formatCode: string | null = null;
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

    if (formatCode == null && knownFormats) {
      const fmt = matchFormatToken(upper, knownFormats);
      if (fmt) {
        formatCode = fmt;
        i++;
        continue;
      }
    }

    if (techniqueCode == null) {
      const tech = matchTechniqueToken(upper);
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

export function auditImportMetadata(
  parsed: ReturnType<typeof parseImportMetadata>,
  catalog: {
    knownSeries?: Set<string>;
    knownTechniques?: Set<string>;
    knownFormats?: Set<string>;
  } = {}
): string[] {
  const { knownSeries, knownTechniques, knownFormats } = catalog;
  const issues: string[] = [];
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

export type ImportOverride = {
  format_code?: string | null;
  technique_code?: string | null;
  series_codes?: string[];
  title?: string | null;
};

export function normalizeImportOverrides(
  raw: unknown
): Record<string, ImportOverride> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, ImportOverride> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!val || typeof val !== 'object') continue;
    const name = String(key).trim();
    if (!name) continue;
    const entry: ImportOverride = {};
    const v = val as Record<string, unknown>;
    if ('format_code' in v) {
      const c = String(v.format_code || '').trim().toUpperCase();
      entry.format_code = c || null;
    }
    if ('technique_code' in v) {
      const c = String(v.technique_code || '').trim().toUpperCase();
      entry.technique_code = c || null;
    }
    if (Array.isArray(v.series_codes)) {
      entry.series_codes = [
        ...new Set(
          v.series_codes.map((c) => String(c || '').trim().toUpperCase()).filter(Boolean)
        ),
      ];
    }
    if ('title' in v) {
      const t = String(v.title || '').trim();
      entry.title = t || null;
    }
    out[name] = entry;
  }
  return out;
}

export function applyImportOverridesToPlanItem(
  entry: {
    originalName: string;
    effectiveMode: ImportMode;
    formatCode: string | null;
    techniqueCode: string | null;
    seriesCodes: string[];
    title: string;
    issues: string[];
    error: string | null;
  },
  override: ImportOverride | undefined,
  catalog: {
    knownSeries?: Set<string>;
    knownTechniques?: Set<string>;
    knownFormats?: Set<string>;
  } = {}
) {
  if (!override || entry.effectiveMode === 'update') return;
  const { knownSeries, knownTechniques, knownFormats } = catalog;

  if ('format_code' in override) entry.formatCode = override.format_code || null;
  if ('technique_code' in override) entry.techniqueCode = override.technique_code || null;
  if ('series_codes' in override) entry.seriesCodes = [...(override.series_codes || [])];
  if ('title' in override && override.title != null) entry.title = override.title;

  const issues: string[] = [];
  for (const code of entry.seriesCodes || []) {
    if (knownSeries?.size && !knownSeries.has(code)) {
      issues.push(`série inconnue : ${code}`);
    }
  }
  if (entry.formatCode && knownFormats?.size && !knownFormats.has(entry.formatCode)) {
    issues.push(`format inconnu : ${entry.formatCode}`);
  }
  if (entry.techniqueCode && knownTechniques?.size && !knownTechniques.has(entry.techniqueCode)) {
    issues.push(`technique inconnue : ${entry.techniqueCode}`);
  }
  entry.issues = issues;
  entry.error = issues.length ? issues.join(' ; ') : null;
}

export function applyOverridesToPlan(
  plan: Array<{
    originalName: string;
    effectiveMode: ImportMode;
    formatCode: string | null;
    techniqueCode: string | null;
    seriesCodes: string[];
    title: string;
    issues: string[];
    error: string | null;
  }>,
  overrides: Record<string, ImportOverride>,
  catalog: {
    knownSeries?: Set<string>;
    knownTechniques?: Set<string>;
    knownFormats?: Set<string>;
  }
) {
  if (!overrides || !plan?.length) return plan;
  for (const item of plan) {
    const ov = overrides[item.originalName];
    if (ov) applyImportOverridesToPlanItem(item, ov, catalog);
  }
  return plan;
}

type ImportCatalog = {
  knownSeries?: Set<string> | null;
  knownTechniques?: Set<string> | null;
  knownFormats?: Set<string> | null;
  knownPhotoStatuses?: Set<string> | null;
  photoStatusCode?: string | null;
};

export function planWorkImports(
  files: Array<{ originalName: string }>,
  importMode: ImportMode,
  existingIds: Set<string>,
  sequentialStart: number,
  catalog: ImportCatalog = {}
) {
  const {
    knownSeries = null,
    knownTechniques = null,
    knownFormats = null,
    knownPhotoStatuses = null,
    photoStatusCode = null,
  } = catalog;
  const items: Array<{
    originalName: string;
    workId: string;
    catalogueBasename: string;
    importMode: ImportMode;
    effectiveMode: ImportMode;
    warning: string | null;
    error: string | null;
    issues: string[];
    seriesCodes: string[];
    title: string;
    formatCode: string | null;
    techniqueCode: string | null;
    year: number | null;
  }> = [];
  const batchAddIds = new Set<string>();
  const batchUpdateIds = new Set<string>();
  let nextSeq = sequentialStart;

  for (const file of files) {
    const originalName = String(file.originalName || '').trim();
    const entry = {
      originalName,
      workId: '',
      catalogueBasename: '',
      importMode,
      effectiveMode: importMode,
      warning: null as string | null,
      error: null as string | null,
      issues: [] as string[],
      seriesCodes: [] as string[],
      title: '',
      formatCode: null as string | null,
      techniqueCode: null as string | null,
      year: null as number | null,
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
        while (
          existingIds.has(formatWorkId(nextSeq)) ||
          batchAddIds.has(formatWorkId(nextSeq))
        ) {
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
        knownSeries: knownSeries || undefined,
        knownTechniques: knownTechniques || undefined,
        knownFormats: knownFormats || undefined,
        workId: entry.workId,
      });
      entry.seriesCodes = parsed.seriesCodes;
      entry.title = parsed.title;
      entry.formatCode = parsed.formatCode;
      entry.techniqueCode = parsed.techniqueCode;
      entry.year = parsed.year;
      const issues = auditImportMetadata(parsed, {
        knownSeries: knownSeries || undefined,
        knownTechniques: knownTechniques || undefined,
        knownFormats: knownFormats || undefined,
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

export function buildWorkRecords(opts: {
  workId: string;
  originalName: string;
  sortOrder: number;
  knownFormats: Set<string>;
  knownTechniques: Set<string>;
  knownSeries: Set<string>;
  photoStatusCode?: string | null;
}) {
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
  const photoCode = photoStatusCode
    ? String(photoStatusCode).trim().toUpperCase()
    : null;

  const dbRow: Record<string, unknown> = {
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

  return {
    dbRow,
    seriesCodes: [...parsed.seriesCodes],
    mediaRel: `catalogue/${catalogueBasename}`,
  };
}

export function buildWorkImageUpdate(opts: {
  workId: string;
  originalName: string;
  fileSizeBytes?: number | null;
}) {
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

export async function persistWorkImageUpdatesToSupabase(
  supabase: SupabaseClient,
  updates: Array<{ workId: string; dbPatch: Record<string, unknown> }>
) {
  for (const { workId, dbPatch } of updates) {
    const { error } = await supabase.from('works').update(dbPatch).eq('id', workId);
    if (error) throw error;
  }
}
