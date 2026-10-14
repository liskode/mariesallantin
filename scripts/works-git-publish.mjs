/**
 * Publication GitHub Pages : commit + push des médias catalogue après import local.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const PUBLISH_PATHSPECS = ['media/catalogue', 'media/works.json', 'media/photos'];

/** MS0805.jpeg, MS0001_titre….jpeg → appartient à l'œuvre (pas MS00051). */
function fileBelongsToWork(basename, id) {
  const b = String(basename || '').toUpperCase();
  return b.startsWith(id) && !/[0-9]/.test(b.charAt(id.length));
}

/**
 * @param {string} root
 */
export async function listMediaPublishStatus(root) {
  // -z : chemins bruts (ni guillemets ni échappement), un enregistrement « XY chemin » par NUL.
  const { stdout } = await execFileAsync(
    'git',
    ['-c', 'core.quotePath=false', 'status', '--porcelain', '-z', '--untracked-files=all', '--', ...PUBLISH_PATHSPECS],
    { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }
  );
  const files = [];
  const workIds = new Set();
  const records = stdout.split('\0');
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    if (rec.length < 4) continue;
    const xy = rec.slice(0, 2);
    const parsed = { status: xy.trim(), path: rec.slice(3) };
    if (xy[0] === 'R' || xy[0] === 'C') i++; // renommage : l'ancien chemin suit
    files.push(parsed);
    const base = path.basename(parsed.path);
    const m = base.match(/^(MS\d{4})/i);
    if (m) workIds.add(m[1].toUpperCase());
  }
  return {
    files,
    workIds: [...workIds].sort(),
    count: files.length,
    clean: files.length === 0,
  };
}

/**
 * @param {string} root
 * @param {string[]} workIds
 */
export function mediaPathsForWorkIds(root, workIds) {
  const paths = new Set(['media/works.json']);
  const ids = (workIds || []).map((id) => String(id).trim().toUpperCase()).filter(Boolean);
  if (!ids.length) return [];

  const catalogueDir = path.join(root, 'media', 'catalogue');
  const thumbDir = path.join(catalogueDir, '_thumbs');

  for (const id of ids) {
    if (fs.existsSync(catalogueDir)) {
      for (const name of fs.readdirSync(catalogueDir)) {
        if (fileBelongsToWork(name, id)) {
          paths.add(`media/catalogue/${name}`);
        }
      }
    }
    if (fs.existsSync(thumbDir)) {
      for (const name of fs.readdirSync(thumbDir)) {
        if (fileBelongsToWork(name, id)) {
          paths.add(`media/catalogue/_thumbs/${name}`);
        }
      }
    }
  }
  return [...paths];
}

/**
 * @param {string} root
 * @param {{ workIds?: string[] }} opts
 */
export async function resolvePublishPaths(root, opts = {}) {
  const status = await listMediaPublishStatus(root);
  const workIds = (opts.workIds || []).map((id) => String(id).trim().toUpperCase()).filter(Boolean);

  // Fichiers supprimés du disque (œuvres supprimées) : à publier aussi, git add enregistre la suppression.
  const deleted = new Set(status.files.filter((f) => f.status === 'D').map((f) => f.path));
  const keep = (p) => fs.existsSync(path.join(root, p)) || deleted.has(p);

  if (!workIds.length) {
    return {
      paths: status.files
        .map((f) => f.path)
        .filter((p) => keep(p) || p === 'media/works.json'),
      status,
    };
  }

  const idSet = new Set(workIds);
  const fromStatus = status.files
    .map((f) => f.path)
    .filter((p) => {
      if (p === 'media/works.json') return true;
      const base = path.basename(p);
      for (const id of idSet) {
        if (fileBelongsToWork(base, id)) return true;
      }
      return false;
    });

  const fromDisk = mediaPathsForWorkIds(root, workIds);
  const paths = [...new Set([...fromStatus, ...fromDisk])].filter(keep);

  return { paths, status };
}

/**
 * @param {string} root
 * @param {{ message: string, workIds?: string[], paths?: string[] }} opts
 */
export async function publishMediaToGitHub(root, opts) {
  const message = String(opts.message || '').trim();
  if (!message) throw new Error('message de commit requis');

  let paths = Array.isArray(opts.paths) ? opts.paths.filter(Boolean) : [];
  if (!paths.length) {
    const resolved = await resolvePublishPaths(root, { workIds: opts.workIds });
    paths = resolved.paths;
  }
  if (!paths.length) {
    return { ok: true, pushed: false, reason: 'nothing_to_publish', paths: [] };
  }

  await execFileAsync('git', ['add', '--', ...paths], { cwd: root, maxBuffer: 8 * 1024 * 1024 });
  await execFileAsync('git', ['commit', '-m', message], { cwd: root });
  await execFileAsync('git', ['push'], { cwd: root, maxBuffer: 8 * 1024 * 1024 });

  return { ok: true, pushed: true, paths, commit_message: message };
}

/**
 * @param {string} root
 */
export async function assertGitRepo(root) {
  try {
    await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: root });
  } catch {
    throw new Error('dépôt git introuvable — ouvrez le projet mariesallantin');
  }
}
