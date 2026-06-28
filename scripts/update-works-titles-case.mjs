#!/usr/bin/env node
/**
 * Met à jour le champ title des œuvres (Supabase + media/works.json) :
 * majuscules → casse titre, mots tout en majuscules dans un titre mixte,
 * retrait de (1)…(9) (global si titre tout majuscule, sinon après « sur papier » / « jaune »).
 *
 * Usage :
 *   node scripts/update-works-titles-case.mjs           # Supabase + works.json
 *   node scripts/update-works-titles-case.mjs --dry-run
 *   node scripts/update-works-titles-case.mjs --json-only
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { normalizeWorkTitle } from './normalize-works-title-case.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const worksPath = path.join(root, 'media', 'works.json');
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

function planTitleUpdate(title) {
  const before = title == null ? '' : String(title);
  if (!before.trim()) {
    return { before, after: before, changed: false };
  }
  const after = normalizeWorkTitle(before);
  return { before, after, changed: after !== before };
}

async function updateSupabase(dryRun) {
  const env = loadEnvFile(path.join(root, '.env'));
  const url = env.SUPABASE_URL || process.env.SUPABASE_URL;
  const key =
    env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    console.warn('Supabase : SUPABASE_URL / clé absents — ignoré.');
    return { changed: 0, skipped: true };
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data: rows, error } = await supabase
    .from('works')
    .select('id, title')
    .order('id', { ascending: true });
  if (error) throw error;

  const updates = [];
  for (const row of rows || []) {
    const { after, changed } = planTitleUpdate(row.title);
    if (changed) updates.push({ id: row.id, title: after });
  }

  console.log('\n--- Supabase ---');
  console.log('Œuvres lues     :', rows?.length ?? 0);
  console.log('Titres à changer:', updates.length);

  if (dryRun) {
    updates.slice(0, 20).forEach((u) => {
      const row = rows.find((r) => r.id === u.id);
      console.log(`  ${u.id}: ${JSON.stringify(row?.title)} → ${JSON.stringify(u.title)}`);
    });
    if (updates.length > 20) console.log(`  … et ${updates.length - 20} autre(s)`);
    return { changed: updates.length, skipped: false };
  }

  let changed = 0;
  let errors = 0;
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);
    const { error: upErr } = await supabase.from('works').upsert(batch, { onConflict: 'id' });
    if (upErr) {
      errors += batch.length;
      console.error(`Lot ${Math.floor(i / BATCH_SIZE) + 1} :`, upErr.message);
    } else {
      changed += batch.length;
      console.log(`Lot ${Math.floor(i / BATCH_SIZE) + 1} : ${batch.length} titre(s) mis à jour`);
    }
  }
  if (errors) process.exitCode = 1;
  return { changed, errors, skipped: false };
}

function updateWorksJson(dryRun) {
  if (!fs.existsSync(worksPath)) {
    console.warn('\nworks.json introuvable — ignoré.');
    return { changed: 0, skipped: true };
  }

  const doc = JSON.parse(fs.readFileSync(worksPath, 'utf8'));
  const works = doc.works || [];
  const changes = [];

  for (const w of works) {
    const { before, after, changed } = planTitleUpdate(w.title);
    if (changed) {
      changes.push({ id: w.id, before, after });
      w.title = after;
    }
  }

  console.log('\n--- media/works.json ---');
  console.log('Œuvres lues     :', works.length);
  console.log('Titres à changer:', changes.length);

  if (dryRun) {
    changes.slice(0, 20).forEach((c) => {
      console.log(`  ${c.id}: ${JSON.stringify(c.before)} → ${JSON.stringify(c.after)}`);
    });
    if (changes.length > 20) console.log(`  … et ${changes.length - 20} autre(s)`);
    return { changed: changes.length, skipped: false };
  }

  if (changes.length) {
    fs.writeFileSync(worksPath, JSON.stringify(doc, null, 2) + '\n', 'utf8');
    console.log('Fichier enregistré.');
  }

  return { changed: changes.length, skipped: false };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const jsonOnly = process.argv.includes('--json-only');

  if (dryRun) console.log('Mode dry-run (aucune écriture).\n');

  if (!jsonOnly) await updateSupabase(dryRun);
  updateWorksJson(dryRun);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
