#!/usr/bin/env node
/**
 * Renomme les formats carrés (codes 4 chiffres) → ###C (ex. 0020 → 020C).
 * Met à jour label, height_cm, width_cm et propage format_code dans works (FK ON UPDATE CASCADE).
 *
 * Usage :
 *   node scripts/migrate-square-format-codes.mjs
 *   node scripts/migrate-square-format-codes.mjs --dry-run
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { squareFormatFromNumericCode, isNumericSquareFormatCode } from './square-format-codes.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

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

function sortOrderForSquare(cm) {
  return 4000 + cm;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
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
  const { data: formats, error: readErr } = await supabase
    .from('formats')
    .select('code, label, width_cm, height_cm, sort_order')
    .order('code');
  if (readErr) throw readErr;

  const toMigrate = (formats || [])
    .filter((f) => isNumericSquareFormatCode(f.code))
    .map((f) => squareFormatFromNumericCode(f.code))
    .sort((a, b) => a.cm - b.cm);

  console.log(`Formats carrés à renommer : ${toMigrate.length}`);
  for (const m of toMigrate) {
    console.log(`  ${m.oldCode} → ${m.newCode}  ${m.label}  (${m.height_cm}×${m.width_cm} cm)`);
  }

  if (dryRun) {
    const { data: works } = await supabase
      .from('works')
      .select('id, format_code')
      .in(
        'format_code',
        toMigrate.map((m) => m.oldCode)
      );
    console.log(`Œuvres concernées : ${works?.length ?? 0}`);
    return;
  }

  for (const m of toMigrate) {
    const old = formats.find((f) => f.code === m.oldCode);
    const row = {
      code: m.newCode,
      label: m.label,
      height_cm: m.height_cm,
      width_cm: m.width_cm,
      sort_order: old?.sort_order ?? sortOrderForSquare(m.cm),
    };
    const { error: insErr } = await supabase.from('formats').upsert(row, { onConflict: 'code' });
    if (insErr) throw new Error(`${m.oldCode}: insert ${m.newCode} — ${insErr.message}`);

    const { error: workErr } = await supabase
      .from('works')
      .update({ format_code: m.newCode })
      .eq('format_code', m.oldCode);
    if (workErr) throw new Error(`${m.oldCode}: works — ${workErr.message}`);

    const { error: delErr } = await supabase.from('formats').delete().eq('code', m.oldCode);
    if (delErr) throw new Error(`${m.oldCode}: delete — ${delErr.message}`);

    console.log(`OK ${m.oldCode} → ${m.newCode}`);
  }

  console.log('Migration terminée.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
