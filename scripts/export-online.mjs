#!/usr/bin/env node
/**
 * Met le tri d'un export en ligne (page tri-photos.html) et synchronise les décisions.
 *
 *   npm run export:en-ligne -- <dossier_export>
 *     1. versions d'affichage 1400 px (+ vignettes déjà faites) → stockage Supabase « tri-photos »
 *     2. cartes (triage.json) → table photo_triage_exports
 *     3. décisions : celles de la base font foi ; les décisions locales absentes y sont ajoutées ;
 *        si les numéros de carte ont changé, les décisions suivent leurs photos
 *     4. résultats d'import locaux (imported.json) → colonne result (carte verrouillée en ligne)
 *
 * Les fonctions syncDecisionsFromDb / pushResultsToDb servent aussi au studio local avant et après un import.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { fetchAll } from './supabase-fetch-all.mjs';

export const BUCKET = 'tri-photos';
const PREVIEW_MAX_SIDE = 1400;

const readJson = (p, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
};
const writeJson = (p, data) => {
  fs.writeFileSync(p + '.tmp', JSON.stringify(data, null, 1));
  fs.renameSync(p + '.tmp', p);
};

/** Identifiant de l'export en ligne (fixé au premier passage dans _baseart/config.json). */
export function exportConfig(exportDir) {
  const file = path.join(exportDir, '_baseart', 'config.json');
  const cfg = readJson(file, null);
  if (cfg?.export_id) return cfg;
  const day = new Date().toISOString().slice(0, 7);
  const slug = path.basename(exportDir).toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const created = { export_id: `${slug}-${day}`, label: `${path.basename(exportDir)} (${day})` };
  writeJson(file, created);
  return created;
}

/** Le tri de cet export est-il en ligne (sinon la base ne contient pas encore ses décisions) ? */
export async function isOnline(exportDir, supabase) {
  const { export_id } = exportConfig(exportDir);
  const { data, error } = await supabase.from('photo_triage_exports').select('id').eq('id', export_id).maybeSingle();
  if (error) throw error;
  return !!data;
}

/** Une décision prise dans le studio local est aussi enregistrée en base (si le tri est en ligne). */
export async function saveDecisionToDb(exportDir, supabase, groupId, decision, photos) {
  const { export_id } = exportConfig(exportDir);
  const { error } = await supabase
    .from('photo_triage_decisions')
    .upsert({ export_id, group_id: groupId, decision, photos, updated_at: new Date().toISOString() });
  if (error) throw error;
}

/** Décisions de la base → decisions.json (la base fait foi). Retourne l'objet des décisions. */
export async function syncDecisionsFromDb(exportDir, supabase) {
  const { export_id } = exportConfig(exportDir);
  const rows = await fetchAll((f, t) =>
    supabase.from('photo_triage_decisions').select('group_id, decision').eq('export_id', export_id).order('group_id').range(f, t)
  );
  const decisions = {};
  for (const r of rows) decisions[r.group_id] = r.decision;
  writeJson(path.join(exportDir, '_baseart', 'decisions.json'), decisions);
  return decisions;
}

/** Résultats d'import (imported.json) → base, pour verrouiller les cartes traitées dans la page en ligne. */
export async function pushResultsToDb(exportDir, supabase) {
  const { export_id } = exportConfig(exportDir);
  const imported = readJson(path.join(exportDir, '_baseart', 'imported.json'), {});
  const triage = readJson(path.join(exportDir, '_baseart', 'triage.json'), { groups: [] });
  const photosOf = new Map(triage.groups.map((g) => [g.id, g.photos.map((p) => p.name)]));
  const decisions = readJson(path.join(exportDir, '_baseart', 'decisions.json'), {});
  const rows = Object.entries(imported).map(([group_id, result]) => ({
    export_id,
    group_id,
    decision: decisions[group_id] || {},
    photos: photosOf.get(group_id) || [],
    result,
    updated_at: new Date().toISOString(),
  }));
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase.from('photo_triage_decisions').upsert(rows.slice(i, i + 200));
    if (error) throw error;
  }
  return rows.length;
}

async function listStored(supabase, folder) {
  const names = new Set();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.storage.from(BUCKET).list(folder, { limit: 1000, offset });
    if (error) throw error;
    for (const o of data || []) names.add(o.name);
    if (!data || data.length < 1000) return names;
  }
}

export async function publishTriageOnline(exportDir, supabase, url, log = console.log) {
  const workDir = path.join(exportDir, '_baseart');
  const { export_id, label } = exportConfig(exportDir);
  const triage = readJson(path.join(workDir, 'triage.json'), null);
  if (!triage) throw new Error('triage.json introuvable : lancez d\'abord npm run export:analyse');

  // 1. Versions d'affichage + envoi des images manquantes
  const mdDir = path.join(workDir, 'md');
  fs.mkdirSync(mdDir, { recursive: true });
  const photos = triage.groups.flatMap((g) => g.photos);
  let made = 0;
  for (const p of photos) {
    const file = path.basename(p.thumb);
    const out = path.join(mdDir, file);
    if (fs.existsSync(out)) continue;
    await sharp(path.join(exportDir, p.name), { limitInputPixels: false })
      .rotate()
      .resize(PREVIEW_MAX_SIDE, PREVIEW_MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 76, mozjpeg: true })
      .toFile(out);
    if (++made % 200 === 0) log(`  versions d'affichage : ${made}`);
  }
  for (const kind of ['th', 'md']) {
    const stored = await listStored(supabase, `${export_id}/${kind}`);
    const todo = photos.map((p) => path.basename(p.thumb)).filter((f) => !stored.has(f));
    let sent = 0;
    const queue = [...new Set(todo)];
    const worker = async () => {
      while (queue.length) {
        const f = queue.shift();
        const body = fs.readFileSync(path.join(workDir, kind, f));
        // Coupures réseau ponctuelles : jusqu'à 4 essais, avec une pause croissante
        for (let attempt = 1; ; attempt++) {
          let failure = null;
          try {
            const { error } = await supabase.storage
              .from(BUCKET)
              .upload(`${export_id}/${kind}/${f}`, body, { contentType: 'image/jpeg', upsert: true, cacheControl: '31536000' });
            failure = error;
          } catch (e) {
            failure = e;
          }
          if (!failure) break;
          if (attempt >= 4) throw new Error(`envoi ${kind}/${f} : ${failure.message || failure}`);
          await new Promise((r) => setTimeout(r, 2000 * attempt));
        }
        if (++sent % 200 === 0) log(`  ${kind} : ${sent}/${todo.length} envoyées`);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    log(`  ${kind} : ${sent} image(s) envoyée(s), ${stored.size} déjà en ligne`);
  }

  // 2. Cartes
  const imageBase = `${url.replace(/\/$/, '')}/storage/v1/object/public/${BUCKET}/${export_id}/`;
  const { error } = await supabase
    .from('photo_triage_exports')
    .upsert({ id: export_id, label, triage, image_base: imageBase, updated_at: new Date().toISOString() });
  if (error) throw error;

  // 3. Décisions : rattachement aux cartes actuelles + ajout des décisions locales absentes de la base
  const groupOfPhoto = new Map();
  for (const g of triage.groups) for (const p of g.photos) groupOfPhoto.set(p.name, g.id);
  const dbRows = await fetchAll((f, t) =>
    supabase.from('photo_triage_decisions').select('group_id, decision, photos, result').eq('export_id', export_id).order('group_id').range(f, t)
  );
  let moved = 0;
  for (const r of dbRows) {
    const votes = new Map();
    for (const n of r.photos || []) {
      const id = groupOfPhoto.get(n);
      if (id) votes.set(id, (votes.get(id) || 0) + 1);
    }
    const to = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (to && to !== r.group_id) {
      await supabase.from('photo_triage_decisions').delete().eq('export_id', export_id).eq('group_id', r.group_id);
      const g = triage.groups.find((x) => x.id === to);
      await supabase.from('photo_triage_decisions').upsert({
        export_id, group_id: to, decision: r.decision, result: r.result, photos: g.photos.map((p) => p.name),
      });
      moved++;
    }
  }
  const inDb = new Set(
    (await fetchAll((f, t) => supabase.from('photo_triage_decisions').select('group_id').eq('export_id', export_id).order('group_id').range(f, t))).map((r) => r.group_id)
  );
  const local = readJson(path.join(workDir, 'decisions.json'), {});
  const photosOf = new Map(triage.groups.map((g) => [g.id, g.photos.map((p) => p.name)]));
  const missing = Object.entries(local)
    .filter(([id]) => !inDb.has(id) && photosOf.has(id))
    .map(([group_id, decision]) => ({ export_id, group_id, decision, photos: photosOf.get(group_id) }));
  if (missing.length) {
    const { error: mErr } = await supabase.from('photo_triage_decisions').upsert(missing);
    if (mErr) throw mErr;
  }
  const results = await pushResultsToDb(exportDir, supabase);
  await syncDecisionsFromDb(exportDir, supabase);
  log(`  cartes en ligne : ${triage.groups.length} ; décisions locales ajoutées : ${missing.length} ; rattachées à une nouvelle carte : ${moved} ; cartes importées : ${results}`);
  return { export_id, image_base: imageBase };
}

// ---- CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { createClient } = await import('@supabase/supabase-js');
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const exportDir = path.resolve(process.argv[2] || '');
  if (!process.argv[2] || !fs.existsSync(exportDir)) {
    console.error('Usage : npm run export:en-ligne -- <dossier_export>');
    process.exit(1);
  }
  const env = {};
  for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
    const t = line.trim();
    const eq = t.indexOf('=');
    if (t && !t.startsWith('#') && eq > 0) env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const res = await publishTriageOnline(exportDir, supabase, env.SUPABASE_URL);
  console.log(`Tri en ligne : export « ${res.export_id} ».`);
}
