#!/usr/bin/env node
/**
 * Génère des miniatures WebP sous media/catalogue/_thumbs/ (miroir des chemins
 * sous catalogue/, même nom de base + .webp). Ne régénère que si la miniature
 * est absente ou plus ancienne que le fichier source (sauf --force).
 *
 * Lecture des chemins : media/works.json (œuvres media^ catalogue/).
 * Pour les nouvelles images : placer le fichier, mettre à jour works.json
 * (ex. build-works-from-list.mjs), puis relancer ce script.
 *
 * Usage :
 *   npm install
 *   npm run catalogue:thumbs
 *   node scripts/generate-catalogue-thumbnails.mjs [--force] [--max=320] [--dry-run]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const worksPath = path.join(root, 'media', 'works.json');

const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry-run');
const FORCE = args.has('--force');
const maxArg = [...args].find((a) => a.startsWith('--max='));
const MAX_EDGE = maxArg ? Math.max(64, parseInt(maxArg.split('=')[1], 10) || 320) : 320;
const WEBP_QUALITY = 82;

const RASTER_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.avif']);

function extLower(filePath) {
  const b = path.basename(filePath);
  const i = b.lastIndexOf('.');
  return i >= 0 ? b.slice(i).toLowerCase() : '';
}

/** @returns {string | null} chemin absolu miniature .webp */
function thumbAbsForMedia(media) {
  const m = String(media || '').trim().replace(/\\/g, '/');
  if (!m.toLowerCase().startsWith('catalogue/')) return null;
  const rest = m.slice('catalogue/'.length);
  if (!rest) return null;
  const norm = rest.replace(/\\/g, '/');
  const lastSlash = norm.lastIndexOf('/');
  const dirPart = lastSlash >= 0 ? norm.slice(0, lastSlash) : '';
  const filePart = lastSlash >= 0 ? norm.slice(lastSlash + 1) : norm;
  if (!RASTER_EXT.has(extLower(filePart))) return null;
  const stem = filePart.replace(/\.[^.]+$/i, '');
  const relThumb = dirPart ? `${dirPart}/${stem}.webp` : `${stem}.webp`;
  return path.join(root, 'media', 'catalogue', '_thumbs', relThumb);
}

function sourceAbsForMedia(media) {
  const m = String(media || '').trim();
  return path.join(root, 'media', ...m.split('/'));
}

async function ensureSharp() {
  try {
    const mod = await import('sharp');
    return mod.default;
  } catch {
    console.error(
      "Module 'sharp' introuvable. À la racine du dépôt : npm install\n" +
        '  puis : npm run catalogue:thumbs'
    );
    process.exit(1);
  }
}

async function generateOne(Sharp, srcAbs, dstAbs) {
  if (DRY) return 'dry';
  await fs.promises.mkdir(path.dirname(dstAbs), { recursive: true });
  await Sharp(srcAbs)
    .rotate()
    .resize({
      width: MAX_EDGE,
      height: MAX_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: WEBP_QUALITY, effort: 4 })
    .toFile(dstAbs);
  return 'ok';
}

async function main() {
  const Sharp = await ensureSharp();
  if (!fs.existsSync(worksPath)) {
    console.error('Fichier absent :', worksPath);
    process.exit(1);
  }
  const raw = fs.readFileSync(worksPath, 'utf8');
  const data = JSON.parse(raw);
  if (!data.works || !Array.isArray(data.works)) {
    console.error('works.json : tableau works absent');
    process.exit(1);
  }

  /** @type {{ media: string, src: string, dst: string | null }[]} */
  const jobs = [];
  const seenDst = new Set();
  for (const w of data.works) {
    const media = String(w.media || '').trim();
    const dst = thumbAbsForMedia(media);
    if (!dst) continue;
    const src = sourceAbsForMedia(media);
    if (seenDst.has(dst)) continue;
    seenDst.add(dst);
    jobs.push({ media, src, dst });
  }

  let skipped = 0;
  let created = 0;
  let missingSrc = 0;
  let errors = 0;
  const toRun = [];

  for (const j of jobs) {
    if (!fs.existsSync(j.src)) {
      missingSrc++;
      console.warn('Source absente :', j.media);
      continue;
    }
    let need = FORCE;
    if (!need && !fs.existsSync(j.dst)) need = true;
    if (!need) {
      const stS = fs.statSync(j.src);
      const stD = fs.statSync(j.dst);
      if (stS.mtimeMs > stD.mtimeMs) need = true;
    }
    if (!need) {
      skipped++;
      continue;
    }
    toRun.push(j);
  }

  const concurrency = 4;
  let idx = 0;
  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= toRun.length) break;
      const j = toRun[i];
      try {
        const r = await generateOne(Sharp, j.src, j.dst);
        if (r === 'ok' || r === 'dry') created++;
      } catch (e) {
        errors++;
        console.warn('Échec miniature', j.media, e && e.message ? e.message : e);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  console.log(
    [
      DRY ? `Miniatures à générer : ${created} (dry-run, rien écrit)` : `Miniatures générées : ${created}`,
      `${skipped} déjà à jour`,
      `${missingSrc} fichier source manquant`,
      `${errors} erreur(s)`,
      `cible max ${MAX_EDGE}px (bord long), WebP q=${WEBP_QUALITY}`,
    ].join(' · ')
  );
  if (errors > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
