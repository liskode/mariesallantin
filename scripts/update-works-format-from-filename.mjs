#!/usr/bin/env node
/**
 * Renseigne works.format_code et works.filename_original depuis media/catalogue/.
 * Crée les codes format manquants dans public.formats.
 *
 * Usage : node scripts/update-works-format-from-filename.mjs [--dry-run]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { parseFormatFromBasename } from './parse-format-from-filename.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const CATALOGUE_DIR = path.join(root, 'media', 'catalogue');
const BATCH_SIZE = 50;
const dryRun = process.argv.includes('--dry-run');

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return {};
  const out = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function listCatalogueFiles() {
  if (!fs.existsSync(CATALOGUE_DIR)) {
    throw new Error(`Dossier introuvable : ${CATALOGUE_DIR}`);
  }
  return fs
    .readdirSync(CATALOGUE_DIR)
    .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
    .sort();
}

function workIdFromBasename(basename) {
  const m = String(basename).match(/^(MS\d{4})/i);
  return m ? m[1].toUpperCase() : null;
}

async function nextFormatSortOrder(supabase) {
  const { data, error } = await supabase
    .from('formats')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1);
  if (error) throw error;
  const max = data?.[0]?.sort_order;
  return Number.isFinite(Number(max)) ? Number(max) + 10 : 1000;
}

async function ensureFormats(supabase, codes, knownFormats) {
  const missing = [...codes].filter((c) => !knownFormats.has(c)).sort();
  if (!missing.length) return { created: 0, codes: [] };

  let sortOrder = await nextFormatSortOrder(supabase);
  const rows = missing.map((code) => {
    const row = { code, label: '', sort_order: sortOrder };
    sortOrder += 10;
    return row;
  });

  if (dryRun) {
    for (const code of missing) knownFormats.add(code);
    return { created: missing.length, codes: missing };
  }

  const { error } = await supabase.from('formats').upsert(rows, { onConflict: 'code' });
  if (error) throw error;
  for (const code of missing) knownFormats.add(code);
  return { created: missing.length, codes: missing };
}

async function main() {
  const env = loadEnvFile(path.join(root, '.env'));
  const url = env.SUPABASE_URL || process.env.SUPABASE_URL;
  const key =
    env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis dans .env');
    process.exit(1);
  }

  const files = listCatalogueFiles();
  const byWorkId = new Map();

  for (const basename of files) {
    const id = workIdFromBasename(basename);
    if (!id) {
      console.warn('Ignoré (pas de MS####) :', basename);
      continue;
    }
    if (byWorkId.has(id)) {
      console.warn(`Doublon pour ${id} :`, byWorkId.get(id), 'vs', basename);
    }
    byWorkId.set(id, basename);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const { data: formatRows, error: fmtErr } = await supabase.from('formats').select('code');
  if (fmtErr) throw fmtErr;
  const knownFormats = new Set((formatRows || []).map((r) => r.code));

  const { data: workRows, error: workErr } = await supabase
    .from('works')
    .select('id, format_code, filename_original')
    .order('sort_order', { ascending: true });
  if (workErr) throw workErr;

  const stats = {
    catalogueFiles: files.length,
    works: workRows?.length || 0,
    withFormat: 0,
    withoutFormat: 0,
    formatsCreated: 0,
    updated: 0,
    errors: 0,
    ambiguous: 0,
  };

  const formatCodesNeeded = new Set();
  const updates = [];

  for (const [id, basename] of byWorkId) {
    const parsed = parseFormatFromBasename(basename);
    if (parsed.formatCode) {
      stats.withFormat++;
      formatCodesNeeded.add(parsed.formatCode);
    } else {
      stats.withoutFormat++;
    }

    const payload = {
      id,
      filename_original: parsed.filenameOriginal,
    };
    if (parsed.imageExt) payload.image_ext = parsed.imageExt;
    if (parsed.formatCode) payload.format_code = parsed.formatCode;

    updates.push({ ...payload, _basename: basename, _format: parsed.formatCode });
  }

  const { created, codes: newCodes } = await ensureFormats(
    supabase,
    formatCodesNeeded,
    knownFormats
  );
  stats.formatsCreated = created;

  if (dryRun) {
    console.log('\n--- Dry run (aucune écriture Supabase) ---');
    console.log('Fichiers catalogue        :', stats.catalogueFiles);
    console.log('Œuvres avec format_code   :', stats.withFormat);
    console.log('Œuvres sans format_code   :', stats.withoutFormat);
    console.log('Formats à créer           :', newCodes.join(', ') || '(aucun)');
    console.log('Mises à jour filename     :', updates.length);
    const sample = updates.filter((u) => u._format).slice(0, 5);
    for (const u of sample) {
      console.log(`  ${u.id} → ${u._format} | ${u.filename_original}`);
    }
    return;
  }

  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE).map(({ _basename, _format, ...row }) => row);
    const { error: upErr } = await supabase.from('works').upsert(batch, { onConflict: 'id' });
    if (upErr) {
      stats.errors += batch.length;
      console.error(`Lot ${Math.floor(i / BATCH_SIZE) + 1} :`, upErr.message);
    } else {
      stats.updated += batch.length;
      console.log(`Lot ${Math.floor(i / BATCH_SIZE) + 1} : ${batch.length} mise(s) à jour`);
    }
  }

  console.log('\n--- Résumé formats ---');
  console.log('Fichiers catalogue        :', stats.catalogueFiles);
  console.log('Œuvres en base            :', stats.works);
  console.log('format_code extrait       :', stats.withFormat);
  console.log('Sans format dans le nom   :', stats.withoutFormat);
  console.log('Formats créés             :', stats.formatsCreated, newCodes.length ? `(${newCodes.join(', ')})` : '');
  console.log('works mises à jour        :', stats.updated);
  console.log('Erreurs                   :', stats.errors);
  if (stats.errors > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
