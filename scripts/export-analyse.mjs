#!/usr/bin/env node
/**
 * Analyse complète d'un export de photothèque, puis construction du fichier de tri.
 *   1. empreintes Vision : œuvres BaseArt les plus proches + photos voisines dans l'export
 *   2. qualité, sha256 et dHash de chaque photo (mesures déjà faites réutilisées)
 *   3. scènes : tableaux détectés, personnes, étiquettes (photos qui ne sont pas des doublons certains)
 *   4. triage.json (export-triage-build.mjs) — les décisions déjà prises sont conservées
 *
 * Usage : cd ~/Documents/BaseArtImport && npm run export:analyse -- <dossier_export>
 * À relancer après un import pour rafraîchir les suggestions (les nouvelles œuvres sont alors reconnues).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { CATALOGUE_CACHE, catalogueImages, runVisionTool, writeList } from './vision.mjs';
import { measureImage } from './image-quality.mjs';
import { computeDHash, sha256File } from './image-fingerprint.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const exportDir = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !fs.existsSync(exportDir)) {
  console.error('Usage : npm run export:analyse -- <dossier_export>');
  process.exit(1);
}
const workDir = path.join(exportDir, '_baseart');
fs.mkdirSync(workDir, { recursive: true });
const SAME = 0.33;

const photos = fs
  .readdirSync(exportDir)
  .filter((n) => /\.(jpe?g|png|tiff?|heic)$/i.test(n) && !n.startsWith('.'))
  .sort()
  .map((n) => path.join(exportDir, n));
const catalogue = catalogueImages();
console.log(`${photos.length} photos dans l'export, ${catalogue.length} œuvres dans le catalogue.`);

// 1. Empreintes et correspondances
writeList(path.join(workDir, 'listA.txt'), catalogue);
writeList(path.join(workDir, 'listB.txt'), photos);
console.log('1/4 Comparaison visuelle…');
await runVisionTool('featureprints', [
  path.join(workDir, 'listA.txt'),
  path.join(workDir, 'listB.txt'),
  path.join(workDir, 'matches.json'),
  CATALOGUE_CACHE,
]);

// 2. Qualité et empreintes de fichier (réutilise les mesures existantes si le fichier n'a pas changé)
console.log('2/4 Qualité des photos…');
const metricsPath = path.join(workDir, 'metrics.json');
const previous = new Map(
  (fs.existsSync(metricsPath) ? JSON.parse(fs.readFileSync(metricsPath, 'utf8')) : []).map((m) => [path.basename(m.file), m])
);
const metrics = [];
let measured = 0;
for (const p of photos) {
  const old = previous.get(path.basename(p));
  const size = fs.statSync(p).size;
  if (old && !old.error && (old.size == null || old.size === size)) {
    metrics.push({ ...old, file: p, size });
    continue;
  }
  try {
    const m = await measureImage(sharp, p);
    metrics.push({
      file: p,
      size,
      sha: await sha256File(p),
      dhash: await computeDHash(sharp, p),
      w: m.width_px,
      h: m.height_px,
      mp: m.megapixels,
      bpp: m.bits_per_pixel,
      sharp: m.laplacian_var,
    });
  } catch (e) {
    metrics.push({ file: p, size, error: String(e.message || e) });
  }
  if (++measured % 100 === 0) console.log(`  ${measured} photo(s) mesurée(s)`);
}
fs.writeFileSync(metricsPath, JSON.stringify(metrics));

// 3. Scènes (photos qui ne sont pas des doublons certains d'une œuvre)
console.log('3/4 Analyse des scènes…');
const matches = JSON.parse(fs.readFileSync(path.join(workDir, 'matches.json'), 'utf8'));
const toScan = matches.filter((x) => x.nearest[0]?.d >= SAME).map((x) => x.file);
writeList(path.join(workDir, 'scan.txt'), toScan);
await runVisionTool('situscan', [
  path.join(workDir, 'scan.txt'),
  path.join(workDir, 'listA.txt'),
  CATALOGUE_CACHE,
  path.join(workDir, 'situ.json'),
]);

// 4. Fichier de tri
console.log('4/4 Fichier de tri…');
execFileSync(process.execPath, [path.join(root, 'scripts', 'export-triage-build.mjs'), exportDir], { stdio: 'inherit' });
