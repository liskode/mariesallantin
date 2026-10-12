#!/usr/bin/env node
/**
 * Publie les médias catalogue en attente (git add / commit / push).
 * Archive d'abord les images des œuvres supprimées de la base (voir works-media-cleanup.mjs).
 * Usage : npm run works:publish
 *         npm run works:publish -- MS0433 MS0434
 */
import { publishMediaToGitHub, resolvePublishPaths } from './works-git-publish.mjs';
import { syncDeletedWorks } from './works-media-cleanup.mjs';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const workIds = process.argv.slice(2).map((id) => id.trim().toUpperCase()).filter(Boolean);

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
const supabaseUrl = env.SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis dans .env');
  process.exit(1);
}
const cleanup = await syncDeletedWorks(
  root,
  createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
);
if (cleanup.work_ids.length) {
  console.log(`Œuvres supprimées de la base : ${cleanup.work_ids.join(' ')}`);
  console.log(`${cleanup.archived.length} fichier(s) archivé(s) dans ${cleanup.archive_dir}`);
}

const { paths } = await resolvePublishPaths(root, {
  workIds: workIds.length ? [...workIds, ...cleanup.work_ids] : [],
});
if (!paths.length) {
  console.log('Aucun fichier média en attente de publication.');
  process.exit(0);
}

console.log(paths.length + ' fichier(s) à publier :');
for (const p of paths) console.log('  ', p);

const message =
  workIds.length === 1
    ? `Publie œuvre ${workIds[0]} sur mariesallantin.art`
    : workIds.length > 1
      ? `Publie œuvres ${workIds[0]}–${workIds[workIds.length - 1]} sur mariesallantin.art`
      : 'Publie médias catalogue sur mariesallantin.art';

const result = await publishMediaToGitHub(root, { message, workIds, paths });
console.log('Publié :', result.commit_message);
console.log('Le site sera à jour dans 1–2 minutes.');
