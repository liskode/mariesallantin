#!/usr/bin/env node
/**
 * Renseigne works.width_cm et works.height_cm depuis title (+ repli filename_original).
 *
 * Usage : node scripts/update-works-dimensions-cm.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { parseDimensionsCmForWork } from './parse-dimensions-cm.mjs';

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

async function main() {
  const env = loadEnvFile(path.join(root, '.env'));
  const url = env.SUPABASE_URL || process.env.SUPABASE_URL;
  const key =
    env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    console.error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis dans .env');
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const { data: rows, error } = await supabase
    .from('works')
    .select('id, title, filename_original')
    .order('sort_order', { ascending: true });

  if (error) throw error;
  if (!rows?.length) {
    console.error('Aucune œuvre dans works.');
    process.exit(1);
  }

  const stats = { total: rows.length, updated: 0, parsed: 0, missing: 0, errors: 0 };
  const updates = [];

  for (const row of rows) {
    const dim = parseDimensionsCmForWork(row.title, row.filename_original);
    if (!dim) {
      stats.missing++;
      continue;
    }
    stats.parsed++;
    updates.push({
      id: row.id,
      width_cm: dim.width_cm,
      height_cm: dim.height_cm,
    });
  }

  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);
    const { error: upErr } = await supabase.from('works').upsert(batch, { onConflict: 'id' });
    if (upErr) {
      stats.errors += batch.length;
      console.error(`Lot ${Math.floor(i / BATCH_SIZE) + 1} :`, upErr.message);
    } else {
      stats.updated += batch.length;
      console.log(`Lot ${Math.floor(i / BATCH_SIZE) + 1} : ${batch.length} mise(s) à jour`);
    }
  }

  const ms17 = updates.find((u) => u.id === 'MS0017');
  console.log('\n--- Résumé ---');
  console.log('Œuvres totales     :', stats.total);
  console.log('Dimensions trouvées:', stats.parsed);
  console.log('Mises à jour       :', stats.updated);
  console.log('Sans dimension     :', stats.missing);
  console.log('Erreurs            :', stats.errors);
  if (ms17) {
    console.log('Exemple MS0017     :', ms17.height_cm, '×', ms17.width_cm, 'cm');
  }
  if (stats.errors > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
