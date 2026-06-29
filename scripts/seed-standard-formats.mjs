#!/usr/bin/env node
/**
 * Renseigne label, height_cm et width_cm des formats standard (Figure / Paysage / Marine).
 * Source : media/standard-formats.json
 *
 * Usage :
 *   node scripts/seed-standard-formats.mjs
 *   node scripts/seed-standard-formats.mjs --dry-run
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const formatsPath = path.join(root, 'media', 'standard-formats.json');

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

function sortOrderForCode(code) {
  const family = code.slice(-1);
  const num = parseInt(code.slice(0, 3), 10);
  const base = family === 'F' ? 1000 : family === 'P' ? 2000 : 3000;
  return base + (Number.isFinite(num) ? num : 0);
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const formats = JSON.parse(fs.readFileSync(formatsPath, 'utf8'));

  const rows = formats.map((f) => ({
    code: String(f.code).trim().toUpperCase(),
    label: String(f.label).trim(),
    height_cm: f.height_cm,
    width_cm: f.width_cm,
    sort_order: sortOrderForCode(String(f.code).trim().toUpperCase()),
  }));

  console.log(`Formats standard : ${rows.length}`);
  if (dryRun) {
    rows.slice(0, 5).forEach((r) => {
      console.log(`  ${r.code}: ${r.label} — H ${r.height_cm} × L ${r.width_cm} cm`);
    });
    console.log('  …');
    console.log('Mode dry-run — aucune écriture.');
    return;
  }

  const env = loadEnvFile(path.join(root, '.env'));
  const url = env.SUPABASE_URL || process.env.SUPABASE_URL;
  const key =
    env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    console.error('SUPABASE_URL / clé absents (.env)');
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { error } = await supabase.from('formats').upsert(rows, { onConflict: 'code' });
  if (error) throw error;

  console.log(`${rows.length} format(s) mis à jour dans Supabase.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
