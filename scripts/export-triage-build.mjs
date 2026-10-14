#!/usr/bin/env node
/**
 * Construit le fichier de tri d'un export de photothèque (triage.json) à partir des analyses :
 *   <travail>/matches.json  (empreintes Vision : œuvres BaseArt les plus proches + voisines dans l'export)
 *   <travail>/metrics.json  (indice de qualité, sha256, dHash de chaque photo)
 *   <travail>/situ.json     (tableaux détectés dans la scène, personnes, étiquettes de scène)
 * et génère les vignettes de la page de tri (<travail>/th/).
 *
 * Usage : node scripts/export-triage-build.mjs <dossier_export> [<dossier_travail>]
 *         (dossier de travail par défaut : <dossier_export>/_baseart)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { fetchAll } from './supabase-fetch-all.mjs';
import { qualityScore } from './image-quality.mjs';
import { parseExportFilename } from './export-filename-meta.mjs';
import { extractMsIdFromFilename } from './work-import.mjs';

export const SAME = 0.33; // en dessous : même œuvre (vérifié à l'œil le 14/10/2026)
export const SUSPECT = 0.47; // 0,33–0,47 : doublon possible

/** Étiquettes Vision typiques d'une scène (atelier, exposition, intérieur) plutôt que d'une œuvre seule. */
const SCENE_LABELS = new Set([
  'crowd', 'interior_room', 'room', 'structure', 'furniture', 'table', 'chair',
  'stool', 'sofa', 'door', 'window', 'portal', 'arch', 'chandelier', 'lamp', 'building', 'housewares',
  'museum', 'gallery', 'office', 'kitchen', 'conveyance', 'easel', 'floor', 'ceiling', 'shelf', 'bookshelf',
]);

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const exportDir = path.resolve(process.argv[2] || '');
const workDir = path.resolve(process.argv[3] || path.join(exportDir, '_baseart'));
if (!process.argv[2] || !fs.existsSync(exportDir)) {
  console.error('Usage : node scripts/export-triage-build.mjs <dossier_export> [<dossier_travail>]');
  process.exit(1);
}

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
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const readJson = (name) => JSON.parse(fs.readFileSync(path.join(workDir, name), 'utf8'));
const matches = readJson('matches.json');
const metrics = new Map(readJson('metrics.json').map((m) => [path.basename(m.file), m]));
const situ = new Map(readJson('situ.json').map((s) => [path.basename(s.file), s]));

const [works, series, formats, techniques] = await Promise.all([
  fetchAll((f, t) => supabase.from('works').select('id, title, year, image_quality').order('id').range(f, t)),
  supabase.from('series').select('code'),
  supabase.from('formats').select('code'),
  supabase.from('techniques').select('code'),
]);
const known = {
  series: new Set(series.data.map((r) => r.code)),
  formats: new Set(formats.data.map((r) => r.code)),
  techniques: new Set(techniques.data.map((r) => r.code)),
};
const workById = new Map(works.map((w) => [w.id, w]));
const workIdOf = (catalogPath) => extractMsIdFromFilename(path.basename(catalogPath));

// ---- Photos
const photos = matches.map((m, i) => {
  const name = path.basename(m.file);
  const met = metrics.get(name) || {};
  const quality =
    met.w && met.h
      ? qualityScore({ megapixels: met.mp, bits_per_pixel: met.bpp, laplacian_var: met.sharp })
      : null;
  const s = situ.get(name);
  // Les figures peintes sont souvent prises pour des personnes : on exige soit un décor (mobilier,
  // architecture, pièce), soit des personnes sur une image qui n'est pas avant tout une peinture.
  const labels = new Map((s?.labels || []).map((l) => [l.l, l.c]));
  const art = Math.max(labels.get('art') || 0, labels.get('painting') || 0);
  const sceneLabels = [...labels].filter(([l, c]) => SCENE_LABELS.has(l) && c >= 0.3).map(([l]) => l);
  const hasPeople = (s?.people || 0) > 0 || ['people', 'adult', 'child'].some((k) => (labels.get(k) || 0) >= 0.3);
  // Tableau détecté n'occupant qu'une partie de l'image : signe d'une vue d'ensemble
  const framed = (s?.paintings || []).some((p) => p.area < 0.6);
  const strong =
    (sceneLabels.length > 0 && art < 0.85 && (framed || art < 0.5)) ||
    (hasPeople && art < 0.4) ||
    (hasPeople && framed && art < 0.7);
  const weak = (sceneLabels.length > 0 && art < 0.85) || (hasPeople && art < 0.6);
  if (hasPeople) sceneLabels.unshift('personnes');
  // Plusieurs tableaux côte à côte sans personne : combinaison (ou polyptyque, à vérifier)
  const multi = !hasPeople && (s?.paintings || []).filter((p) => p.area >= 0.05 && p.area <= 0.6).length >= 2;
  if (framed) sceneLabels.push('tableau(x) dans la scène');
  return {
    i,
    name,
    art: Math.round(art * 100) / 100,
    multi,
    quality,
    w: met.w || null,
    h: met.h || null,
    sha: met.sha || null,
    nearest: m.nearest.map((n) => ({ work: workIdOf(n.a), d: Math.round(n.d * 1000) / 1000 })),
    siblings: m.siblings,
    scene: s && (strong || weak) ? { strong, labels: sceneLabels } : null,
    crops: (s?.paintings || []).map((p) => p.matches.map((x) => ({ work: workIdOf(x.a), d: x.d }))),
    meta: parseExportFilename(name, known),
  };
});

// ---- Groupes : photos de la même toile (distance < SAME), union-find
const parent = photos.map((_, i) => i);
const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
for (const p of photos) for (const s of p.siblings) if (s.d < SAME) parent[find(p.i)] = find(s.i);
const byRoot = new Map();
for (const p of photos) {
  const r = find(p.i);
  if (!byRoot.has(r)) byRoot.set(r, []);
  byRoot.get(r).push(p);
}

const groups = [];
for (const members of byRoot.values()) {
  members.sort((a, b) => (b.quality ?? -1) - (a.quality ?? -1));
  const best = members[0];
  // Œuvre BaseArt correspondante (majorité des photos sous le seuil)
  const votes = new Map();
  for (const p of members) {
    const n = p.nearest[0];
    if (n && n.d < SAME) votes.set(n.work, (votes.get(n.work) || 0) + 1);
  }
  const dupWork = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  // Œuvres proches (doublons possibles) : meilleure distance par œuvre
  const near = new Map();
  for (const p of members) for (const n of p.nearest) if (!near.has(n.work) || n.d < near.get(n.work)) near.set(n.work, n.d);
  const nearest = [...near.entries()].map(([work, d]) => ({ work, d })).sort((a, b) => a.d - b.d).slice(0, 3);
  // Suggestions in situ : œuvres reconnues dans les tableaux découpés
  const cand = new Map();
  for (const p of members) for (const crop of p.crops) for (const c of crop) if (c.d < 0.85 && (!cand.has(c.work) || c.d < cand.get(c.work))) cand.set(c.work, c.d);
  const situCandidates = [...cand.entries()].map(([work, d]) => ({ work, d: Math.round(d * 1000) / 1000 })).sort((a, b) => a.d - b.d).slice(0, 8);

  const meta = { ...best.meta, series: [...new Set(members.flatMap((p) => p.meta.series))] };
  for (const k of ['year', 'format', 'technique', 'title']) {
    if (!meta[k]) meta[k] = members.map((p) => p.meta[k]).find(Boolean) || (k === 'title' ? '' : null);
  }

  // Indices tirés des noms de fichiers du groupe
  const names = members.map((p) => p.name).join(' ');
  const isDetail = /d[ée]tail|DETAI/i.test(names);
  const isCombination = /combi/i.test(names);
  const isEnsemble = /dipty|dypt|tripty|polyp/i.test(names); // diptyque, polyptyque : une seule œuvre
  let typeHint = null;
  if (isDetail) typeHint = 'D';
  else if (isCombination || (best.multi && !isEnsemble)) typeHint = 'M';

  let proposal = 'new';
  if (dupWork) proposal = 'duplicate';
  else if (best.scene?.strong || isDetail || isCombination) proposal = 'situ';
  const current = dupWork ? workById.get(dupWork) : null;
  groups.push({
    id: '',
    photos: members.map((p) => ({ name: p.name, quality: p.quality, w: p.w, h: p.h, sha: p.sha })),
    proposal,
    work: dupWork,
    work_quality: current?.image_quality ?? null,
    replace_suggested: !!(current && best.quality != null && current.image_quality != null && best.quality >= current.image_quality + 15),
    nearest,
    suspect: !dupWork && nearest[0] && nearest[0].d < SUSPECT ? nearest[0] : null,
    scene: best.scene,
    maybe_situ: !dupWork && !best.scene?.strong && !isDetail && !isCombination && (!!best.scene || (best.multi && !isEnsemble)),
    type_hint: typeHint,
    hint: isDetail ? 'détail (nom du fichier)' : isCombination ? 'combinaison (nom du fichier)' : best.multi && !isEnsemble ? 'plusieurs tableaux côte à côte' : null,
    situ_candidates: situCandidates,
    meta,
    _members: members.map((p) => p.i),
  });
}
groups.sort((a, b) => a.photos[0].name.localeCompare(b.photos[0].name, 'fr'));
groups.forEach((g, n) => (g.id = 'g' + String(n + 1).padStart(4, '0')));

// Doublons possibles entre groupes non rattachés (0,33–0,47)
const groupOf = new Map();
for (const g of groups) for (const i of g._members) groupOf.set(i, g.id);
const pairs = new Map();
for (const p of photos) {
  for (const s of p.siblings) {
    if (s.d < SAME || s.d >= SUSPECT) continue;
    const a = groupOf.get(p.i);
    const b = groupOf.get(s.i);
    if (a === b) continue;
    const k = a < b ? a + '|' + b : b + '|' + a;
    if (!pairs.has(k) || s.d < pairs.get(k)) pairs.set(k, s.d);
  }
}
for (const g of groups) delete g._members;

// ---- Vignettes
const thDir = path.join(workDir, 'th');
fs.mkdirSync(thDir, { recursive: true });
const thumbName = (name) => crypto.createHash('sha1').update(name).digest('hex').slice(0, 16) + '.jpg';
let made = 0;
const queue = photos.map((p) => p.name);
async function worker() {
  while (queue.length) {
    const name = queue.shift();
    const out = path.join(thDir, thumbName(name));
    if (fs.existsSync(out)) continue;
    try {
      await sharp(path.join(exportDir, name), { limitInputPixels: false })
        .rotate()
        .resize(480, 480, { fit: 'inside' })
        .jpeg({ quality: 78 })
        .toFile(out);
      if (++made % 200 === 0) console.log(`  vignettes : ${made}`);
    } catch (e) {
      console.warn('vignette impossible :', name, e.message);
    }
  }
}
await Promise.all([worker(), worker(), worker(), worker()]);
for (const g of groups) for (const p of g.photos) p.thumb = 'th/' + thumbName(p.name);

// Les décisions et le suivi d'import sont rangés par numéro de carte : si les cartes ont changé
// (photos ajoutées ou retirées), on les rattache à la nouvelle carte qui contient les mêmes photos.
const triagePath = path.join(workDir, 'triage.json');
if (fs.existsSync(triagePath)) {
  const prev = JSON.parse(fs.readFileSync(triagePath, 'utf8'));
  const newIdByPhoto = new Map();
  for (const g of groups) for (const p of g.photos) newIdByPhoto.set(p.name, g.id);
  const remap = new Map();
  for (const g of prev.groups || []) {
    const votes = new Map();
    for (const p of g.photos) {
      const id = newIdByPhoto.get(p.name);
      if (id) votes.set(id, (votes.get(id) || 0) + 1);
    }
    const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best) remap.set(g.id, best[0]);
  }
  for (const name of ['decisions.json', 'imported.json']) {
    const file = path.join(workDir, name);
    if (!fs.existsSync(file)) continue;
    const old = JSON.parse(fs.readFileSync(file, 'utf8'));
    const next = {};
    let moved = 0;
    for (const [id, v] of Object.entries(old)) {
      const to = remap.get(id);
      if (!to) {
        console.warn(`  ${name} : carte ${id} sans équivalent (photos retirées de l'export), conservée sous son ancien numéro`);
        next[id] = v;
        continue;
      }
      if (to !== id) moved++;
      next[to] = { ...(next[to] || {}), ...v };
    }
    if (moved) {
      fs.copyFileSync(file, file + '.avant-renumerotation');
      fs.writeFileSync(file, JSON.stringify(next, null, 1));
      console.log(`  ${name} : ${moved} entrée(s) rattachée(s) à leur nouvelle carte (sauvegarde : ${name}.avant-renumerotation)`);
    }
  }
}

const triage = {
  export_dir: exportDir,
  generated_at: new Date().toISOString(),
  thresholds: { same: SAME, suspect: SUSPECT },
  groups,
  group_pairs: [...pairs.entries()].map(([k, d]) => ({ a: k.split('|')[0], b: k.split('|')[1], d: Math.round(d * 1000) / 1000 })),
};
fs.writeFileSync(triagePath, JSON.stringify(triage));
const count = (p) => groups.filter((g) => g.proposal === p).length;
console.log(
  `${photos.length} photos → ${groups.length} groupes : ${count('duplicate')} déjà dans BaseArt, ` +
    `${count('new')} nouvelles (dont ${groups.filter((g) => g.suspect).length} proches d'une œuvre), ` +
    `${count('situ')} autres photos ; ${triage.group_pairs.length} paires de doublons possibles entre nouvelles.`
);
