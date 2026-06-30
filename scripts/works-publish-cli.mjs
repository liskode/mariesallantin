#!/usr/bin/env node
/**
 * Publie les médias catalogue en attente (git add / commit / push).
 * Usage : npm run works:publish
 *         npm run works:publish -- MS0433 MS0434
 */
import { publishMediaToGitHub, resolvePublishPaths } from './works-git-publish.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const workIds = process.argv.slice(2).map((id) => id.trim().toUpperCase()).filter(Boolean);

const { paths } = await resolvePublishPaths(root, { workIds });
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
