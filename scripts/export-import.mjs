/**
 * Import des groupes triés « Nouvelle » d'un export de photothèque (voir export-triage-*.mjs).
 *
 * Pour chaque groupe : code MS suivant, original copié tel quel dans ~/Documents/BaseArt-originaux/,
 * version allégée (2560 px) dans media/catalogue/MS####.jpeg + miniature, indice de qualité mesuré
 * sur l'original, fiche Supabase (statut « À valider »), entrée works.json.
 * Le suivi (<export>/_baseart/imported.json) empêche d'importer deux fois le même groupe.
 *
 * CLI : node scripts/export-import.mjs <dossier_export> [--limit=50] [--dry-run] [--avec-non-vues]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { computeDHash, sha256Buffer } from './image-fingerprint.mjs';
import { measureImage, qualityScore } from './image-quality.mjs';
import { moveFile } from './works-media-cleanup.mjs';
import {
  appendWorksJsonEntries,
  buildWorkRecordsFromPlanItem,
  fetchNextSortOrder,
  formatWorkId,
  generateThumbnailForMedia,
  resolveNextSequentialStart,
} from './work-import.mjs';

export const WEB_MAX_SIDE = 2560;
export const WEB_JPEG_QUALITY = 85;

export function originalsDir(root) {
  return process.env.BASEART_ORIGINALS_DIR || path.join(root, '..', 'BaseArt-originaux');
}

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}
function writeJson(p, data) {
  fs.writeFileSync(p + '.tmp', JSON.stringify(data, null, 1));
  fs.renameSync(p + '.tmp', p);
}

/**
 * Groupes à importer comme nouvelles œuvres, pas encore importés : décision « new » validée,
 * ou aussi proposition automatique non vue si includeUnreviewed.
 */
export function pendingNewGroups(exportDir, { includeUnreviewed = false } = {}) {
  const work = path.join(exportDir, '_baseart');
  const triage = readJson(path.join(work, 'triage.json'), { groups: [] });
  const decisions = readJson(path.join(work, 'decisions.json'), {});
  const imported = readJson(path.join(work, 'imported.json'), {});
  return triage.groups
    .filter((g) => !imported[g.id])
    .filter((g) => (decisions[g.id]?.category ? decisions[g.id].category === 'new' : includeUnreviewed && g.proposal === 'new'))
    .map((g) => ({ group: g, decision: decisions[g.id] || {} }));
}

/** Version allégée pour le site : JPEG sRGB, 2560 px maximum, sans agrandissement. */
export async function makeWebVersion(srcAbs, destAbs) {
  await fs.promises.mkdir(path.dirname(destAbs), { recursive: true });
  await sharp(srcAbs, { limitInputPixels: false })
    .rotate()
    .resize(WEB_MAX_SIDE, WEB_MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
    .toColourspace('srgb')
    .jpeg({ quality: WEB_JPEG_QUALITY, mozjpeg: true })
    .toFile(destAbs);
}

/**
 * @param {{ root: string, exportDir: string, supabase: import('@supabase/supabase-js').SupabaseClient,
 *           limit?: number, dryRun?: boolean, log?: (msg: string) => void }} opts
 */
export async function importNewGroups(opts) {
  const { root, exportDir, supabase, limit = 50, dryRun = false, includeUnreviewed = false, log = console.log } = opts;
  const workDir = path.join(exportDir, '_baseart');
  const importedPath = path.join(workDir, 'imported.json');
  const pending = pendingNewGroups(exportDir, { includeUnreviewed });
  const batch = pending.slice(0, limit);
  if (!batch.length) return { imported: [], remaining: 0 };

  const worksJsonPath = path.join(root, 'media', 'works.json');
  const mediaRoot = path.join(root, 'media');
  const origDir = originalsDir(root);
  let nextNum = await resolveNextSequentialStart(supabase, worksJsonPath);
  let sortOrder = await fetchNextSortOrder(supabase);
  const done = [];

  for (const { group, decision } of batch) {
    const bestName = decision.best || group.photos[0].name;
    const srcAbs = path.join(exportDir, bestName);
    if (!fs.existsSync(srcAbs)) {
      log(`  ${group.id} : photo introuvable (${bestName}), ignoré`);
      continue;
    }
    const workId = formatWorkId(nextNum);
    const m = group.meta || {};
    const item = {
      title: m.title || '',
      year: m.year || null,
      formatCode: m.format || null,
      techniqueCode: m.technique || null,
      seriesCodes: m.series || [],
    };
    const built = buildWorkRecordsFromPlanItem({
      workId,
      originalName: 'photo.jpeg',
      sortOrder,
      photoStatusCode: null,
      item,
    });
    built.dbRow.filename_original = bestName;
    if (dryRun) {
      log(`  ${group.id} → ${workId} : ${bestName} (simulation)`);
      done.push({ group: group.id, work: workId });
      nextNum++;
      sortOrder++;
      continue;
    }

    // Version allégée publiée + miniature
    const webAbs = path.join(mediaRoot, ...built.mediaRel.split('/'));
    await makeWebVersion(srcAbs, webAbs);
    await generateThumbnailForMedia(mediaRoot, built.mediaRel);
    const thumbAbs = path.join(mediaRoot, 'catalogue', '_thumbs', workId + '.webp');

    // Qualité (original) et empreintes (fichier publié)
    const measures = await measureImage(sharp, srcAbs);
    const webBuf = await fs.promises.readFile(webAbs);
    Object.assign(built.dbRow, {
      image_quality: qualityScore(measures),
      image_quality_details: measures,
      file_sha256: sha256Buffer(webBuf),
      phash: await computeDHash(sharp, webBuf),
      file_size_bytes: webBuf.length,
    });

    // Fiche : insertion stricte (jamais d'écrasement) ; en cas d'échec, on retire les fichiers créés
    const { error } = await supabase.from('works').insert(built.dbRow);
    if (error) {
      for (const f of [webAbs, thumbAbs]) await fs.promises.rm(f, { force: true });
      throw new Error(`${workId} : ${error.message}`);
    }
    if (built.seriesCodes.length) {
      const { error: sErr } = await supabase
        .from('work_series')
        .insert(built.seriesCodes.map((code) => ({ work_id: workId, series_code: code })));
      if (sErr) throw new Error(`${workId} séries : ${sErr.message}`);
    }
    appendWorksJsonEntries(worksJsonPath, [built.jsonRow]);

    // Original intact, nommé par l'identifiant (pleine résolution, hors site)
    const ext = path.extname(bestName).toLowerCase() || '.jpeg';
    await fs.promises.mkdir(origDir, { recursive: true });
    await fs.promises.copyFile(srcAbs, path.join(origDir, workId + ext));

    const imported = readJson(importedPath, {});
    imported[group.id] = { work: workId, photo: bestName, at: new Date().toISOString() };
    writeJson(importedPath, imported);
    done.push({ group: group.id, work: workId });
    log(`  ${group.id} → ${workId} : ${bestName}`);
    nextNum++;
    sortOrder++;
  }
  return { imported: done, remaining: pending.length - done.length };
}

/** Doublons pour lesquels « remplacer la photo » est coché et pas encore fait. */
export function pendingReplacements(exportDir) {
  const work = path.join(exportDir, '_baseart');
  const triage = readJson(path.join(work, 'triage.json'), { groups: [] });
  const decisions = readJson(path.join(work, 'decisions.json'), {});
  const imported = readJson(path.join(work, 'imported.json'), {});
  return triage.groups
    .filter((g) => !imported[g.id])
    .filter((g) => {
      const d = decisions[g.id] || {};
      return (d.category || g.proposal) === 'duplicate' && d.replace === true && (d.work !== undefined ? d.work : g.work);
    })
    .map((g) => ({ group: g, decision: decisions[g.id] || {}, workId: decisions[g.id]?.work || g.work }));
}

/**
 * Remplace la photo de référence d'œuvres existantes par la meilleure photo du groupe.
 * Ancienne image + miniature + ancien original → ~/Documents/BaseArt-archives/photos-remplacees/AAAA-MM-JJ/.
 * Seuls la photo, l'indice de qualité et les empreintes changent ; les informations de la fiche sont conservées.
 */
export async function replacePhotos(opts) {
  const { root, exportDir, supabase, limit = 50, dryRun = false, log = console.log } = opts;
  const importedPath = path.join(exportDir, '_baseart', 'imported.json');
  const pending = pendingReplacements(exportDir);
  const batch = pending.slice(0, limit);
  const worksJsonPath = path.join(root, 'media', 'works.json');
  const mediaRoot = path.join(root, 'media');
  const catalogueDir = path.join(mediaRoot, 'catalogue');
  const origDir = originalsDir(root);
  const day = new Date().toISOString().slice(0, 10);
  const archiveDir = path.join(
    process.env.BASEART_ARCHIVE_DIR ? path.dirname(process.env.BASEART_ARCHIVE_DIR) : path.join(root, '..', 'BaseArt-archives'),
    'photos-remplacees',
    day
  );
  const belongs = (name, id) => name.toUpperCase().startsWith(id) && !/[0-9]/.test(name.charAt(id.length));
  const done = [];

  for (const { group, decision, workId } of batch) {
    const bestName = decision.best || group.photos[0].name;
    const srcAbs = path.join(exportDir, bestName);
    const { data: row, error: rErr } = await supabase.from('works').select('id').eq('id', workId).maybeSingle();
    if (rErr) throw rErr;
    if (!row || !fs.existsSync(srcAbs)) {
      log(`  ${group.id} : ${!row ? 'œuvre ' + workId + ' introuvable' : 'photo introuvable'}, ignoré`);
      continue;
    }
    if (dryRun) {
      log(`  ${group.id} → ${workId} : nouvelle photo ${bestName} (simulation)`);
      done.push({ group: group.id, work: workId });
      continue;
    }
    // Archive l'ancienne image, sa miniature et l'ancien original
    for (const name of fs.readdirSync(catalogueDir)) {
      if (belongs(name, workId) && fs.statSync(path.join(catalogueDir, name)).isFile()) {
        await moveFile(path.join(catalogueDir, name), path.join(archiveDir, 'catalogue', name));
      }
    }
    const thumbDir = path.join(catalogueDir, '_thumbs');
    for (const name of fs.existsSync(thumbDir) ? fs.readdirSync(thumbDir) : []) {
      if (belongs(name, workId)) await moveFile(path.join(thumbDir, name), path.join(archiveDir, 'catalogue', '_thumbs', name));
    }
    for (const name of fs.existsSync(origDir) ? fs.readdirSync(origDir) : []) {
      if (belongs(name, workId)) await moveFile(path.join(origDir, name), path.join(archiveDir, 'originaux', name));
    }

    // Nouvelle photo
    const mediaRel = `catalogue/${workId}.jpeg`;
    const webAbs = path.join(mediaRoot, 'catalogue', workId + '.jpeg');
    await makeWebVersion(srcAbs, webAbs);
    await generateThumbnailForMedia(mediaRoot, mediaRel);
    const measures = await measureImage(sharp, srcAbs);
    const webBuf = await fs.promises.readFile(webAbs);
    const { error } = await supabase
      .from('works')
      .update({
        image_ext: 'jpeg',
        filename_original: bestName,
        image_quality: qualityScore(measures),
        image_quality_details: measures,
        file_sha256: sha256Buffer(webBuf),
        phash: await computeDHash(sharp, webBuf),
        file_size_bytes: webBuf.length,
      })
      .eq('id', workId);
    if (error) throw new Error(`${workId} : ${error.message}`);
    appendWorksJsonEntries(worksJsonPath, [{ id: workId, media: mediaRel }]);
    await fs.promises.mkdir(origDir, { recursive: true });
    await fs.promises.copyFile(srcAbs, path.join(origDir, workId + (path.extname(bestName).toLowerCase() || '.jpeg')));

    const imported = readJson(importedPath, {});
    imported[group.id] = { work: workId, photo: bestName, replaced: true, at: new Date().toISOString() };
    writeJson(importedPath, imported);
    done.push({ group: group.id, work: workId });
    log(`  ${group.id} → ${workId} : photo remplacée par ${bestName}`);
  }
  return { replaced: done, remaining: pending.length - done.length };
}

export const PHOTO_MAX_SIDE = 2048;

/** Groupes triés « autre photo » (décision explicite) avec au moins une œuvre rattachée, pas encore importés. */
export function pendingOtherPhotos(exportDir) {
  const work = path.join(exportDir, '_baseart');
  const triage = readJson(path.join(work, 'triage.json'), { groups: [] });
  const decisions = readJson(path.join(work, 'decisions.json'), {});
  const imported = readJson(path.join(work, 'imported.json'), {});
  return triage.groups
    .filter((g) => !imported[g.id] && decisions[g.id]?.category === 'situ')
    .map((g) => ({ group: g, decision: decisions[g.id] }))
    .filter(({ decision }) => Array.isArray(decision.situ_works) && decision.situ_works.length);
}

/**
 * Importe les « autres photos » (atelier, exposition, collectionneur, combinaison, détail…) :
 * version allégée dans media/photos/, original dans BaseArt-originaux/autres-photos/,
 * fiche work_photos + liens vers les œuvres.
 */
export async function importOtherPhotos(opts) {
  const { root, exportDir, supabase, limit = 50, dryRun = false, log = console.log } = opts;
  const importedPath = path.join(exportDir, '_baseart', 'imported.json');
  const pending = pendingOtherPhotos(exportDir);
  const batch = pending.slice(0, limit);
  const mediaRoot = path.join(root, 'media');
  const origDir = path.join(originalsDir(root), 'autres-photos');
  const done = [];

  for (const { group, decision } of batch) {
    const bestName = decision.best || group.photos[0].name;
    const srcAbs = path.join(exportDir, bestName);
    const ids = [...new Set(decision.situ_works.map((w) => String(w).toUpperCase()))].sort();
    const { data: found, error: fErr } = await supabase.from('works').select('id').in('id', ids);
    if (fErr) throw fErr;
    const existing = new Set((found || []).map((r) => r.id));
    const links = ids.filter((id) => existing.has(id));
    if (!links.length || !fs.existsSync(srcAbs)) {
      log(`  ${group.id} : ${!links.length ? 'aucune œuvre rattachée existante' : 'photo introuvable'}, ignoré`);
      continue;
    }
    const type = /^[AECMDX]$/.test(decision.situ_type || '') ? decision.situ_type : 'X';
    const id = crypto.randomUUID();
    const base = `${links[0]}-${type}-${id.slice(0, 8)}.jpeg`;
    if (dryRun) {
      log(`  ${group.id} → ${base} (${links.join(' ')}) (simulation)`);
      done.push({ group: group.id, photo_id: id });
      continue;
    }
    const webAbs = path.join(mediaRoot, 'photos', base);
    const thumbAbs = path.join(mediaRoot, 'photos', '_thumbs', base.replace(/\.jpeg$/, '.webp'));
    await fs.promises.mkdir(path.dirname(thumbAbs), { recursive: true });
    await sharp(srcAbs, { limitInputPixels: false })
      .rotate()
      .resize(PHOTO_MAX_SIDE, PHOTO_MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
      .toColourspace('srgb')
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(webAbs);
    await sharp(webAbs).resize(320, 320, { fit: 'inside' }).webp({ quality: 80 }).toFile(thumbAbs);
    const measures = await measureImage(sharp, srcAbs);
    const webBuf = await fs.promises.readFile(webAbs);
    const { error } = await supabase.from('work_photos').insert({
      id,
      file_path: 'media/photos/' + base,
      type_code: type,
      caption: String(decision.caption || '').trim(),
      source_filename: bestName,
      image_quality: qualityScore(measures),
      width_px: measures.width_px,
      height_px: measures.height_px,
      file_sha256: sha256Buffer(webBuf),
    });
    if (error) {
      for (const f of [webAbs, thumbAbs]) await fs.promises.rm(f, { force: true });
      throw new Error(`${group.id} : ${error.message}`);
    }
    const { error: lErr } = await supabase
      .from('work_photo_links')
      .insert(links.map((work_id) => ({ photo_id: id, work_id })));
    if (lErr) throw new Error(`${group.id} liens : ${lErr.message}`);
    await fs.promises.mkdir(origDir, { recursive: true });
    await fs.promises.copyFile(srcAbs, path.join(origDir, base.replace(/\.jpeg$/, path.extname(bestName).toLowerCase() || '.jpeg')));

    const imported = readJson(importedPath, {});
    imported[group.id] = { photo_id: id, file: base, works: links, at: new Date().toISOString() };
    writeJson(importedPath, imported);
    done.push({ group: group.id, photo_id: id, works: links });
    log(`  ${group.id} → ${base} (${links.join(' ')})`);
  }
  return { added: done, remaining: pending.length - done.length };
}

// ---- CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { createClient } = await import('@supabase/supabase-js');
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const args = process.argv.slice(2);
  const exportDir = path.resolve(args.find((a) => !a.startsWith('--')) || '');
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const env = {};
  for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
    const t = line.trim();
    const eq = t.indexOf('=');
    if (t && !t.startsWith('#') && eq > 0) env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const res = await importNewGroups({
    root,
    exportDir,
    supabase,
    limit: limitArg ? parseInt(limitArg.split('=')[1], 10) : 50,
    dryRun: args.includes('--dry-run'),
    includeUnreviewed: args.includes('--avec-non-vues'),
  });
  console.log(`${res.imported.length} œuvre(s) importée(s), ${res.remaining} restante(s).`);
}
