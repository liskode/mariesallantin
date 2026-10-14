#!/usr/bin/env node
/**
 * Doublons possibles entre œuvres : compare les photos du catalogue entre elles (empreintes Vision)
 * et enregistre les paires proches dans work_similarities (outil ♊ de l'éditeur).
 * Les décisions déjà prises (« pas un doublon ») sont conservées.
 *
 * Usage : cd ~/Documents/BaseArtImport && npm run works:similar
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { CATALOGUE_CACHE, catalogueImages, runVisionTool, writeList } from './vision.mjs';
import { extractMsIdFromFilename } from './work-import.mjs';
import { fetchAll } from './supabase-fetch-all.mjs';

export const SUSPECT = 0.47; // au-delà : œuvres différentes (étalonné le 14/10/2026)

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = {};
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
  const t = line.trim();
  const eq = t.indexOf('=');
  if (t && !t.startsWith('#') && eq > 0) env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
}
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const images = catalogueImages();
const tmp = path.join(CATALOGUE_CACHE, 'run');
writeList(path.join(tmp, 'catalogue.txt'), images);
console.log(`${images.length} photos du catalogue à comparer…`);
await runVisionTool('featureprints', [
  path.join(tmp, 'catalogue.txt'),
  path.join(tmp, 'catalogue.txt'),
  path.join(tmp, 'self.json'),
  CATALOGUE_CACHE,
]);
const result = JSON.parse(fs.readFileSync(path.join(tmp, 'self.json'), 'utf8'));

const dbIds = new Set(
  (await fetchAll((f, t) => supabase.from('works').select('id').order('id').range(f, t))).map((r) => r.id)
);
const pairs = new Map();
result.forEach((x, i) => {
  const a = extractMsIdFromFilename(path.basename(images[i]));
  for (const s of x.siblings) {
    if (s.d >= SUSPECT) continue;
    const b = extractMsIdFromFilename(path.basename(images[s.i]));
    if (!a || !b || a === b || !dbIds.has(a) || !dbIds.has(b)) continue;
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const k = lo + '|' + hi;
    if (!pairs.has(k) || s.d < pairs.get(k)) pairs.set(k, s.d);
  }
});
const rows = [...pairs.entries()].map(([k, d]) => {
  const [work_a, work_b] = k.split('|');
  return { work_a, work_b, distance: Math.round(d * 1000) / 1000, updated_at: new Date().toISOString() };
});
// Upsert sans la colonne status : une paire déjà marquée « pas un doublon » le reste
for (let i = 0; i < rows.length; i += 500) {
  const { error } = await supabase.from('work_similarities').upsert(rows.slice(i, i + 500), { onConflict: 'work_a,work_b' });
  if (error) throw error;
}
const near = rows.filter((r) => r.distance < 0.33).length;
console.log(`${rows.length} paire(s) enregistrée(s) : ${near} quasi identiques (< 0,33), ${rows.length - near} doublons possibles.`);
