#!/usr/bin/env node
/**
 * Préfixe chaque fichier image du catalogue avec MSxxxx- (xxxx = 0001, 0002, …)
 * dans l’ordre des lignes de data/catalogue-filenames.txt (même convention que build-works-from-list.mjs).
 *
 * Renommage en 2 passes pour éviter les collisions de noms.
 * Si un nom commence déjà par MSdddd-, ce préfixe est retiré avant d’appliquer le numéro d’ordre courant.
 *
 * Usage :
 *   node scripts/prefix-ms-catalogue-files.mjs              # exécute + réécrit la liste
 *   node scripts/prefix-ms-catalogue-files.mjs --dry-run    # affiche seulement
 *
 * Ensuite : node scripts/build-works-from-list.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const dryRun = process.argv.includes('--dry-run');
const args = process.argv.slice(2).filter((a) => a !== '--dry-run');
const listPath = path.resolve(args[0] || path.join(root, 'data', 'catalogue-filenames.txt'));
const imagesDir = path.resolve(args[1] || path.join(root, 'media', 'catalogue'));

function cleanLine(line) {
  return line
    .replace(/^\uFEFF/, '')
    .replace(/^\s*-\s*/, '')
    .trim();
}

function isImageFilename(name) {
  return /\.(jpe?g|png|gif|webp|tiff?)$/i.test(name) && !/\.zip$/i.test(name);
}

function stripMsPrefix(basename) {
  return basename.replace(/^MS\d{4}[\s_-]+/i, '');
}

function msId(n) {
  return `MS${String(n).padStart(4, '0')}`;
}

function main() {
  const raw = fs.readFileSync(listPath, 'utf8');
  const basenames = raw
    .split(/\r|\n/)
    .map((l) => cleanLine(l))
    .filter(Boolean)
    .filter(isImageFilename)
    .map((line) => path.basename(line));

  if (!basenames.length) {
    console.error('Aucune ligne image dans', listPath);
    process.exit(1);
  }

  const plan = basenames.map((basename, i) => {
    const n = i + 1;
    const rest = stripMsPrefix(basename);
    const finalName = `${msId(n)}-${rest}`;
    return { basename, rest, finalName, index: i };
  });

  const missing = [];
  const noop = [];

  for (const p of plan) {
    const absFrom = path.join(imagesDir, p.basename);
    if (!fs.existsSync(absFrom)) missing.push(p.basename);
    if (p.basename === p.finalName) noop.push(p.basename);
  }

  if (missing.length) {
    if (dryRun) {
      console.warn(
        `Attention : ${missing.length} fichier(s) absent(s) sous ${imagesDir} — prévisualisation des noms cibles quand même.\n`
      );
    } else {
      console.error('Fichiers absents sous', imagesDir, ':');
      missing.slice(0, 40).forEach((m) => console.error(' -', m));
      if (missing.length > 40) console.error(' …', missing.length - 40, 'autre(s)');
      console.error('\nCorrigez data/catalogue-filenames.txt ou copiez les images, puis relancez.');
      process.exit(1);
    }
  }

  const toRename = plan.filter((p) => p.basename !== p.finalName);
  if (!toRename.length) {
    console.log('Tous les noms sont déjà au format MSxxxx- pour cet ordre. Rien à faire.');
    return;
  }

  console.log(dryRun ? '[dry-run] ' : '', toRename.length, 'fichier(s) à renommer sur', plan.length);

  if (dryRun) {
    toRename.slice(0, 15).forEach((p) => console.log(`  ${p.basename}\n  → ${p.finalName}`));
    if (toRename.length > 15) console.log('  …');
    return;
  }

  const stage1Name = (i, ext) => `.__ms_stage1_${String(i).padStart(4, '0')}${ext}`;

  for (const p of toRename) {
    const ext = path.extname(p.basename) || path.extname(p.finalName);
    const tmp = stage1Name(p.index, ext);
    const absFrom = path.join(imagesDir, p.basename);
    const absTmp = path.join(imagesDir, tmp);
    if (fs.existsSync(absTmp)) {
      console.error('Collision temporaire:', tmp, 'existe déjà. Abandon.');
      process.exit(1);
    }
    fs.renameSync(absFrom, absTmp);
  }

  for (const p of toRename) {
    const ext = path.extname(p.basename) || path.extname(p.finalName);
    const tmp = stage1Name(p.index, ext);
    const absTmp = path.join(imagesDir, tmp);
    const absFinal = path.join(imagesDir, p.finalName);
    if (fs.existsSync(absFinal)) {
      console.error('Cible existe déjà:', p.finalName, '— abandon (restaurer les .__ms_stage1_* manuellement si besoin).');
      process.exit(1);
    }
    fs.renameSync(absTmp, absFinal);
  }

  const newListBody =
    plan.map((p) => `- ${p.finalName}`).join('\n') + '\n';
  fs.writeFileSync(listPath, newListBody, 'utf8');
  console.log('Liste mise à jour :', listPath);
  console.log('Renommage terminé. Lancez : node scripts/build-works-from-list.mjs');
}

main();
