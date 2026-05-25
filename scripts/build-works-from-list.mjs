#!/usr/bin/env node
/**
 * Génère media/works.json à partir d'une liste de noms de fichiers (un par ligne, CR ou LF).
 * Usage : node scripts/build-works-from-list.mjs [liste.txt] [dossier_images]
 * Liste par défaut : media/works_numero.txt s'il existe, sinon data/catalogue-filenames.txt.
 * Formats :
 *   - tirets (catalogue historique) : légende = dernier tiret avant l’extension ;
 *   - works_numero (MS0001_… avec _) : légende = dernier _ après le préfixe MS#### ; id = MS lu dans le nom.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import os from 'os';
import {
  extractLegendFromBasename,
  extractLegendFromUnderscoreCatalogue,
  extractSeriesCodesFromBase,
  isUnderscoreMsCatalogueStem,
  photoStatusFromBase,
  stripCatalogueIdPrefix,
} from '../legend-filename.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const defaultList = fs.existsSync(path.join(root, 'media', 'works_numero.txt'))
  ? path.join(root, 'media', 'works_numero.txt')
  : path.join(root, 'data', 'catalogue-filenames.txt');

const listPath = path.resolve(process.argv[2] || defaultList);
const imagesDir = path.resolve(process.argv[3] || path.join(root, 'media', 'catalogue'));
const outPath = path.join(root, 'media', 'works.json');

/** Libellés optionnels pour les codes 5 lettres les plus courants (sinon = code). */
const SERIES_LABELS = {
  ABSTR: 'Abstractions',
  APHRO: 'Aphrodite',
  ENCRE: 'Encre de Chine',
  NUITS: 'Nuits perdues',
  MASQU: 'Masques, miroir et statuette',
  MUSEE: 'Musées',
  DANAE: 'Danaé',
  DANTE: 'Dante',
  ENFER: 'Enfer',
  PURGA: 'Purgatoire',
  CIEUX: 'Cieux',
  JUGEM: 'Jugement dernier',
  POLYP: 'Polyptyques',
  OFF: 'Hors catalogue / atelier',
  ENCOURS: 'En cours',
  ATELI: 'Atelier',
  RESUR: 'Résurrection',
  UNIVE: 'Univers',
  ROUGE: 'Variations rouges',
  BLEUE: 'Variations bleues',
  METAM: 'Métamorphoses',
  META: 'Métamorphoses',
  COMPA: 'Comparaison',
  PUTTI: 'Putti',
  MUSE: 'Musée',
  OVIRI: 'Oviri / Gauguin',
  IRENT: 'Purgatoire',
  MAUVA: 'Mauvais temps pour les anges',
  ANGES: 'Anges',
  JUPIT: 'Jupiter',
  AIGLE: 'Aigle',
  ZEUS: 'Zeus',
  COURS: 'Course',
  BAIN: 'Bain',
  CHUTE: 'Chute',
  SIEST: 'Sieste',
  REPOS: 'Repos',
  MEDIT: 'Méditerranée',
  ORAGE: 'Orage',
  PARAD: 'Paradis',
  DIVIN: 'Divine comédie',
  ATTEN: 'Attente des élus',
  LUCIF: 'Lucifer',
  DETAI: 'Détail',
  EXPOI: 'Export',
};

function cleanLine(line) {
  return line
    .replace(/^\uFEFF/, '')
    .replace(/^\s*-\s*/, '')
    .trim();
}

function probeImage(absPath) {
  if (!fs.existsSync(absPath)) {
    return { tailleMo: null, dimensions: null };
  }
  const st = fs.statSync(absPath);
  const tailleMo = Math.round((st.size / (1024 * 1024)) * 1000) / 1000;
  let dimensions = null;
  if (os.platform() === 'darwin') {
    try {
      const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', absPath], {
        encoding: 'utf8',
      });
      const m1 = /pixelWidth:\s*(\d+)/.exec(out);
      const m2 = /pixelHeight:\s*(\d+)/.exec(out);
      if (m1 && m2) dimensions = `${m1[1]}x${m2[1]}`;
    } catch {
      /* ignore */
    }
  }
  return { tailleMo, dimensions };
}

function isImageFilename(name) {
  return /\.(jpe?g|png|gif|webp|tiff?)$/i.test(name) && !/\.zip$/i.test(name);
}

function idFromMsBasename(basename) {
  const m = basename.match(/^(MS)(\d{4})/i);
  return m ? `MS${m[2]}` : null;
}

const raw = fs.readFileSync(listPath, 'utf8');
const lines = raw.split(/\r|\n/).map((l) => cleanLine(l)).filter(Boolean);

const entries = [];
for (const line of lines) {
  if (!isImageFilename(line)) continue;
  const basename = path.basename(line);
  const baseNoExt = basename.replace(/\.(jpe?g|png|gif|webp|tiff?)$/i, '');

  let title;
  let series;
  let photo;
  let id = null;

  if (isUnderscoreMsCatalogueStem(baseNoExt)) {
    title = extractLegendFromUnderscoreCatalogue(basename);
    const afterMs = stripCatalogueIdPrefix(baseNoExt);
    const hyphenRest = afterMs.replace(/_/g, '-');
    series = extractSeriesCodesFromBase(hyphenRest);
    photo = photoStatusFromBase(hyphenRest);
    id = idFromMsBasename(basename);
  } else {
    title = extractLegendFromBasename(basename);
    series = extractSeriesCodesFromBase(baseNoExt);
    photo = photoStatusFromBase(baseNoExt);
  }

  const media = `catalogue/${basename}`;
  const absImage = path.join(imagesDir, basename);
  const { tailleMo, dimensions } = probeImage(absImage);
  entries.push({ basename, title, series, photo, media, tailleMo, dimensions, id });
}

const allCodes = new Set();
for (const e of entries) e.series.forEach((c) => allCodes.add(c));
const seriesOrder = [...allCodes].sort((a, b) => a.localeCompare(b));
const series = seriesOrder.map((code) => [code, SERIES_LABELS[code] || code]);

const works = entries.map((e, i) => {
  const id = e.id || `MS${String(i + 1).padStart(4, '0')}`;
  return {
    id,
    media: e.media,
    title: e.title,
    series: e.series,
    photo: e.photo,
    publish: 'VAL',
    ...(e.dimensions != null ? { dimensions: e.dimensions } : {}),
    ...(e.tailleMo != null ? { tailleMo: e.tailleMo } : {}),
  };
});

const statePath = path.join(root, 'media', 'catalog-state.json');
let prev = {};
try {
  prev = JSON.parse(fs.readFileSync(statePath, 'utf8') || '{}');
} catch {
  /* fichier absent ou invalide */
}
const catalogState = { ...prev };
for (const w of works) {
  if (/_OFF_/i.test(w.media)) catalogState[w.id] = 'S';
}
fs.writeFileSync(statePath, JSON.stringify(catalogState, null, 2) + '\n', 'utf8');

const payload = {
  version: 2,
  description:
    'Catalogue v2 : fichiers sous media/catalogue/. id MS####. publish = toujours VAL (à valider) dans works.json ; état Suspendu (S) dans catalog-state.json pour les chemins contenant _OFF_. Légende : tirets ou underscores (works_numero). photo = OK | Redo. tailleMo / dimensions si fichiers présents.',
  series,
  works,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
console.log('Liste :', listPath);
console.log('Images :', imagesDir, fs.existsSync(imagesDir) ? '(existe)' : '(absent — tailles/dims à null)');
console.log('Œuvres :', works.length, '→', outPath);
