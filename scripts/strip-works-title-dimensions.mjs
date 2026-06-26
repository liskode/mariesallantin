#!/usr/bin/env node
/**
 * Retire les dimensions (cm) des titres lorsque width_cm et height_cm sont renseignés.
 *
 * Usage : node scripts/strip-works-title-dimensions.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { stripDimensionsCmFromText } from './parse-dimensions-cm.mjs';

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
    .select('id, title, width_cm, height_cm')
    .not('width_cm', 'is', null)
    .not('height_cm', 'is', null)
    .order('sort_order', { ascending: true });

  if (error) throw error;
  if (!rows?.length) {
    console.error('Aucune œuvre avec width_cm et height_cm renseignés.');
    process.exit(1);
  }

  const updates = [];
  for (const row of rows) {
    const cleaned = stripDimensionsCmFromText(row.title);
    if (cleaned !== row.title) {
      updates.push({ id: row.id, title: cleaned });
    }
  }

  const stats = {
    eligible: rows.length,
    changed: 0,
    unchanged: rows.length - updates.length,
    errors: 0,
  };

  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);
    const { error: upErr } = await supabase.from('works').upsert(batch, { onConflict: 'id' });
    if (upErr) {
      stats.errors += batch.length;
      console.error(`Lot ${Math.floor(i / BATCH_SIZE) + 1} :`, upErr.message);
    } else {
      stats.changed += batch.length;
      console.log(`Lot ${Math.floor(i / BATCH_SIZE) + 1} : ${batch.length} titre(s) nettoyé(s)`);
    }
  }

  const sample = updates.find((u) => u.id === 'MS0017');
  console.log('\n--- Résumé ---');
  console.log('Œuvres avec dimensions en base :', stats.eligible);
  console.log('Titres nettoyés              :', stats.changed);
  console.log('Titres inchangés             :', stats.unchanged);
  console.log('Erreurs                      :', stats.errors);
  if (sample) {
    console.log('Exemple MS0017               :', sample.title);
  }
  if (stats.errors > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
