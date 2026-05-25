#!/usr/bin/env node
/**
 * Met à jour media/works.json : tailleMo et dimensions (px) pour chaque œuvre
 * dont le champ media pointe vers un fichier sous media/catalogue/.
 *
 * Usage : node scripts/enrich-catalogue-works-json.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readJpegDimensionsFromFile } from './jpeg-dimensions.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const worksPath = path.join(root, 'media', 'works.json');

const raw = fs.readFileSync(worksPath, 'utf8');
const data = JSON.parse(raw);
if (!data.works || !Array.isArray(data.works)) {
  console.error('works.json : tableau works absent');
  process.exit(1);
}

let updated = 0;
let missing = 0;

data.works = data.works.map((w) => {
  const media = String(w.media || '').trim();
  if (!media.toLowerCase().startsWith('catalogue/')) return w;
  const abs = path.join(root, 'media', ...media.split('/'));
  if (!fs.existsSync(abs)) {
    missing++;
    return w;
  }
  const st = fs.statSync(abs);
  const tailleMo = Math.round((st.size / (1024 * 1024)) * 1000) / 1000;
  const dim = readJpegDimensionsFromFile(abs);
  const next = { ...w, tailleMo };
  if (dim) next.dimensions = `${dim.w} × ${dim.h} px`;
  updated++;
  return next;
});

fs.writeFileSync(worksPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log('Œuvres catalogue enrichies :', updated, '| fichiers absents :', missing);
console.log('Écrit :', worksPath);
