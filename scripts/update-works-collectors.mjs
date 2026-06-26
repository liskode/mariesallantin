#!/usr/bin/env node
/**
 * Met à jour collectors + works.collector_code depuis title / filename_original.
 *
 * Prérequis : migrations collectors (type + code PK) exécutées.
 *
 * Usage : node scripts/update-works-collectors.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { ensureCollectorByName } from './collector-utils.mjs';
import { parseCollectorForWork } from './parse-collector.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const BATCH_SIZE = 50;

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

function loadMediaBasenameById(worksJsonPath) {
  const map = new Map();
  if (!fs.existsSync(worksJsonPath)) return map;
  const data = JSON.parse(fs.readFileSync(worksJsonPath, 'utf8'));
  for (const w of data.works || []) {
    const media = String(w.media || '');
    const base = media.includes('/') ? media.slice(media.lastIndexOf('/') + 1) : media;
    if (w.id && base) map.set(w.id, base);
  }
  return map;
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

  const mediaById = loadMediaBasenameById(path.join(root, 'media', 'works.json'));
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const { data: rows, error } = await supabase
    .from('works')
    .select('id, title, filename_original')
    .order('sort_order', { ascending: true });

  if (error) throw error;

  /** @type {Map<string, string>} name → code */
  const collectorCache = new Map();
  const workUpdates = [];
  const collectorSummary = new Map();

  for (const row of rows || []) {
    const parsed = parseCollectorForWork(
      row.title,
      row.filename_original,
      mediaById.get(row.id)
    );
    if (!parsed) continue;

    const code = await ensureCollectorByName(
      supabase,
      { name: parsed.name, collector_type: parsed.collector_type },
      collectorCache
    );
    if (!code) continue;

    collectorSummary.set(code, { code, name: parsed.name, collector_type: parsed.collector_type });
    workUpdates.push({ id: row.id, collector_code: code });
  }

  const stats = {
    works: rows?.length || 0,
    withCollector: workUpdates.length,
    collectors: collectorSummary.size,
    linked: 0,
    errors: 0,
  };

  for (let i = 0; i < workUpdates.length; i += BATCH_SIZE) {
    const batch = workUpdates.slice(i, i + BATCH_SIZE);
    const { error: wErr } = await supabase.from('works').upsert(batch, { onConflict: 'id' });
    if (wErr) {
      stats.errors += batch.length;
      console.error(`works lot ${Math.floor(i / BATCH_SIZE) + 1}:`, wErr.message);
      if (wErr.message.includes('collector_code')) {
        console.error(
          '→ Exécutez supabase/migrations/20250617160000_collectors_code_pk.sql'
        );
      }
    } else {
      stats.linked += batch.length;
    }
  }

  console.log('\n--- Résumé collectionneurs ---');
  console.log('Œuvres totales              :', stats.works);
  console.log('Œuvres avec provenance      :', stats.withCollector);
  console.log('Collectionneurs distincts   :', stats.collectors);
  console.log('Liens works.collector_code  :', stats.linked);
  console.log('Erreurs                     :', stats.errors);
  console.log('\nCollectionneurs :');
  for (const c of [...collectorSummary.values()].sort((a, b) =>
    a.name.localeCompare(b.name, 'fr')
  )) {
    console.log(`  - ${c.code} ${c.name} (${c.collector_type})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
