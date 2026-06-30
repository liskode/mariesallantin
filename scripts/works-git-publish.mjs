/**
 * Publication GitHub Pages : commit + push des médias catalogue après import local.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const PUBLISH_PATHSPECS = ['media/catalogue', 'media/works.json'];

function parseGitShortLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return null;
  const status = trimmed.slice(0, 2).trim();
  let file = trimmed.slice(3).trim();
  if (file.startsWith('"') && file.endsWith('"')) {
    file = file
      .slice(1, -1)
      .replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
  return { status, path: file };
}

/**
 * @param {string} root
 */
export async function listMediaPublishStatus(root) {
  const { stdout } = await execFileAsync(
    'git',
    ['status', '--short', '--', ...PUBLISH_PATHSPECS],
    { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }
  );
  const files = [];
  const workIds = new Set();
  for (const line of stdout.split('\n')) {
    const parsed = parseGitShortLine(line);
    if (!parsed) continue;
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
        if (name.toUpperCase().startsWith(id + '.')) {
          paths.add(`media/catalogue/${name}`);
        }
      }
    }
    if (fs.existsSync(thumbDir)) {
      for (const name of fs.readdirSync(thumbDir)) {
        if (name.toUpperCase().startsWith(id + '.')) {
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

  if (!workIds.length) {
    return {
      paths: status.files
        .map((f) => f.path)
        .filter((p) => {
          const abs = path.join(root, p);
          return fs.existsSync(abs) || p === 'media/works.json';
        }),
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
        if (base.toUpperCase().startsWith(id + '.')) return true;
      }
      return false;
    });

  const fromDisk = mediaPathsForWorkIds(root, workIds);
  const paths = [...new Set([...fromStatus, ...fromDisk])].filter((p) => {
    const abs = path.join(root, p);
    return fs.existsSync(abs);
  });

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
