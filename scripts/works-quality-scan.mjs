#!/usr/bin/env node
/**
 * Calcule l'indice de qualité (0–100) de la photo de chaque œuvre et l'enregistre dans Supabase.
 *
 * Usage :
 *   cd ~/Documents/BaseArtImport
 *   npm run works:quality              # œuvres sans indice
 *   npm run works:quality -- --force   # recalcule tout
 *   npm run works:quality -- --dry-run # calcule sans écrire
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { measureImage, qualityScore } from './image-quality.mjs';
import { fetchAll } from './supabase-fetch-all.mjs';
import { extractMsIdFromFilename } from './work-import.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const DRY = args.includes('--dry-run');

function loadEnvFile(envPath) {
  const out = {};
  if (!fs.existsSync(envPath)) return out;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    const eq = t.indexOf('=');
    if (!t || t.startsWith('#') || eq < 0) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

const env = loadEnvFile(path.join(root, '.env'));
const url = env.SUPABASE_URL || process.env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis dans .env');
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

const works = await fetchAll((from, to) =>
  supabase.from('works').select('id, image_quality').order('id').range(from, to)
);
const catalogueDir = path.join(root, 'media', 'catalogue');
const fileById = new Map();
for (const name of fs.readdirSync(catalogueDir)) {
  const id = extractMsIdFromFilename(name);
  if (id && !fileById.has(id)) fileById.set(id, path.join(catalogueDir, name));
}

const todo = works.filter((w) => FORCE || w.image_quality == null);
console.log(`${todo.length} œuvre(s) à mesurer sur ${works.length}${DRY ? ' (simulation)' : ''}.`);
let done = 0;
let missing = 0;
for (const w of todo) {
  const file = fileById.get(w.id);
  if (!file) {
    missing++;
    continue;
  }
  const m = await measureImage(sharp, file);
  const score = qualityScore(m);
  if (!DRY) {
    const { error } = await supabase
      .from('works')
      .update({ image_quality: score, image_quality_details: m })
      .eq('id', w.id);
    if (error) throw error;
  }
  done++;
  if (done % 100 === 0) console.log(`  ${done}/${todo.length}`);
}
console.log(`Terminé : ${done} mesurée(s), ${missing} sans image.`);
