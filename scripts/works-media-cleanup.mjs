/**
 * Œuvres supprimées de la base : archive leurs images (+ miniatures) hors du dépôt
 * et retire leurs entrées de works.json, pour que la publication les retire du site.
 *
 * Archive : ~/Documents/BaseArt-archives/oeuvres-supprimees/AAAA-MM-JJ/
 * (dossier voisin du dépôt, modifiable via BASEART_ARCHIVE_DIR).
 */
import fs from 'node:fs';
import path from 'node:path';
import { extractMsIdFromFilename, loadWorksJsonIds, removeWorksJsonEntries } from './work-import.mjs';

const MEDIA_DIRS = ['media/catalogue', 'media/catalogue/_thumbs'];

export function deletedArchiveRoot(root) {
  return (
    process.env.BASEART_ARCHIVE_DIR ||
    path.join(root, '..', 'BaseArt-archives', 'oeuvres-supprimees')
  );
}

function listMediaFiles(root) {
  const out = [];
  for (const dir of MEDIA_DIRS) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    for (const name of fs.readdirSync(abs)) {
      if (name.startsWith('.')) continue;
      if (!fs.statSync(path.join(abs, name)).isFile()) continue;
      out.push({ rel: `${dir}/${name}`, id: extractMsIdFromFilename(name) });
    }
  }
  return out;
}

export async function moveFile(src, dest) {
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  let target = dest;
  const ext = path.extname(dest);
  const stem = dest.slice(0, dest.length - ext.length);
  for (let n = 2; fs.existsSync(target); n++) target = `${stem}_${n}${ext}`;
  try {
    await fs.promises.rename(src, target);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    await fs.promises.copyFile(src, target);
    await fs.promises.unlink(src);
  }
  return target;
}

/**
 * Déplace images et miniatures des œuvres vers l'archive.
 * @param {string} root racine du dépôt
 * @param {string[]} workIds
 * @returns {Promise<{ archived: string[], archive_dir: string }>} chemins relatifs déplacés
 */
export async function archiveWorkMedia(root, workIds) {
  const ids = new Set((workIds || []).map((id) => String(id).trim().toUpperCase()));
  const day = new Date().toISOString().slice(0, 10);
  const archiveDir = path.join(deletedArchiveRoot(root), day);
  const archived = [];
  for (const f of listMediaFiles(root)) {
    if (!f.id || !ids.has(f.id)) continue;
    const dest = path.join(archiveDir, f.rel.replace(/^media\//, ''));
    await moveFile(path.join(root, f.rel), dest);
    archived.push(f.rel);
  }
  return { archived, archive_dir: archiveDir };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {Promise<Set<string>>}
 */
async function fetchAllWorkIds(supabase) {
  const ids = new Set();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('works')
      .select('id')
      .order('id')
      .range(from, from + pageSize - 1);
    if (error) throw error;
    for (const r of data || []) ids.add(String(r.id).toUpperCase());
    if (!data || data.length < pageSize) break;
  }
  return ids;
}

/**
 * Repère les œuvres présentes dans media/ ou works.json mais absentes de la base
 * (supprimées depuis l'éditeur en ligne), archive leurs fichiers et nettoie works.json.
 * @param {string} root
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function syncDeletedWorks(root, supabase) {
  const dbIds = await fetchAllWorkIds(supabase);
  if (!dbIds.size) throw new Error('Base vide ou inaccessible : ménage des œuvres supprimées annulé.');

  const worksJsonPath = path.join(root, 'media', 'works.json');
  const candidates = new Set(loadWorksJsonIds(worksJsonPath));
  for (const f of listMediaFiles(root)) if (f.id) candidates.add(f.id);
  const orphanIds = [...candidates].filter((id) => !dbIds.has(id)).sort();
  if (!orphanIds.length) return { work_ids: [], archived: [], archive_dir: null };

  // Garde-fou : un écart massif signale plutôt un problème de base qu'une suppression voulue.
  const limit = Math.max(20, Math.round(dbIds.size * 0.2));
  if (orphanIds.length > limit) {
    throw new Error(
      `${orphanIds.length} œuvres du site sont absentes de la base : ménage automatique annulé par sécurité.`
    );
  }

  removeWorksJsonEntries(worksJsonPath, orphanIds);
  const { archived, archive_dir } = await archiveWorkMedia(root, orphanIds);
  return { work_ids: orphanIds, archived, archive_dir };
}
