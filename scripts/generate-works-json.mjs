#!/usr/bin/env node
/**
 * Génère media/works.json à partir de media/titles.txt (une série par dossier).
 * Usage : depuis la racine du dépôt : node scripts/generate-works-json.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const titlesPath = path.join(root, 'media', 'titles.txt');
const outPath = path.join(root, 'media', 'works.json');

const text = fs.readFileSync(titlesPath, 'utf8');
const lines = text.split('\n');
const series = [];
const works = [];

for (const line of lines) {
  if (line.startsWith('#')) {
    const rest = line.slice(1);
    const semi = rest.indexOf(';');
    if (semi === -1) continue;
    const code = rest.slice(0, semi).trim();
    const name = rest.slice(semi + 1).trim();
    if (code && name) series.push([code, name]);
  } else if (line.includes('/') && line.includes(';')) {
    const semi = line.indexOf(';');
    const media = line.slice(0, semi).trim();
    const title = line.slice(semi + 1).trim();
    const folder = media.split('/')[0];
    works.push({
      id: media,
      media,
      title,
      series: [folder],
    });
  }
}

const payload = {
  version: 1,
  description:
    'Œuvres : id unique (souvent = chemin du fichier), media = chemin sous media/, series = codes de séries (plusieurs possibles). Éditer ce fichier ou régénérer depuis titles.txt.',
  series,
  works,
};

fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
console.log('Écrit', outPath, '—', works.length, 'œuvres,', series.length, 'séries.');
