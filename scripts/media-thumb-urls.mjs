/**
 * URLs vignette / image pleine depuis un chemin media (catalogue/…).
 */
import fs from 'fs';
import path from 'path';

const RASTER_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.avif']);

function pathExtLower(filePart) {
  const i = filePart.lastIndexOf('.');
  return i >= 0 ? filePart.slice(i).toLowerCase() : '';
}

function foldName(name) {
  return String(name)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

/**
 * Résout un chemin relatif sous media/ (macOS : NFC/NFD, petites différences de nom).
 * @param {string} mediaRoot
 * @param {string} rel
 * @returns {string | null} chemin relatif résolu sous media/
 */
export function resolveMediaRelativePath(mediaRoot, rel) {
  const clean = String(rel || '').trim().replace(/\\/g, '/');
  if (!clean || clean.includes('..')) return null;

  const root = path.resolve(mediaRoot);
  const variants = [clean, clean.normalize('NFC'), clean.normalize('NFD')];

  for (const variant of variants) {
    const abs = path.resolve(root, variant);
    if (abs.startsWith(root + path.sep) || abs === root) {
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return variant;
    }
  }

  const parts = clean.split('/');
  const fileName = parts.pop();
  if (!fileName) return null;
  const dirRel = parts.join('/');
  const dirAbs = path.resolve(root, dirRel);
  if (!dirAbs.startsWith(root + path.sep) && dirAbs !== root) return null;
  if (!fs.existsSync(dirAbs) || !fs.statSync(dirAbs).isDirectory()) return null;

  const want = foldName(fileName);
  for (const entry of fs.readdirSync(dirAbs)) {
    if (foldName(entry) !== want) continue;
    const entryAbs = path.join(dirAbs, entry);
    if (!fs.statSync(entryAbs).isFile()) continue;
    return dirRel ? `${dirRel}/${entry}` : entry;
  }

  return null;
}

/** @returns {string | null} ex. catalogue/_thumbs/foo.webp */
export function webThumbRelFromMediaFp(mediaFp) {
  const fp = String(mediaFp || '')
    .trim()
    .replace(/\\/g, '/');
  if (!fp.toLowerCase().startsWith('catalogue/')) return null;
  const rest = fp.slice('catalogue/'.length);
  const lastSlash = rest.lastIndexOf('/');
  const filePart = lastSlash >= 0 ? rest.slice(lastSlash + 1) : rest;
  if (!RASTER_EXT.has(pathExtLower(filePart))) return null;
  const stem = filePart.replace(/\.[^.]+$/i, '');
  const dirPart = lastSlash >= 0 ? rest.slice(0, lastSlash) : '';
  return dirPart
    ? `catalogue/_thumbs/${dirPart}/${stem}.webp`
    : `catalogue/_thumbs/${stem}.webp`;
}

export function encodeMediaPath(url) {
  return String(url)
    .split('/')
    .map((seg, i) => (i === 0 ? seg : encodeURIComponent(String(seg).normalize('NFC'))))
    .join('/');
}

export function mediaUrlFromRelative(rel) {
  return rel ? '/media/' + encodeMediaPath(rel) : null;
}

/**
 * @param {string} mediaFp chemin relatif sous media/ (ex. catalogue/MS0001.jpeg)
 * @param {string} mediaRoot chemin absolu vers media/
 * @returns {{ thumb_url: string | null, full_url: string | null }}
 */
export function workImageUrls(mediaFp, mediaRoot) {
  const rel = String(mediaFp || '').trim().replace(/\\/g, '/');
  if (!rel) return { thumb_url: null, full_url: null };

  const fullRel = resolveMediaRelativePath(mediaRoot, rel);
  const full_url = mediaUrlFromRelative(fullRel);

  const thumbRelCandidate = webThumbRelFromMediaFp(rel);
  const thumbRel = thumbRelCandidate
    ? resolveMediaRelativePath(mediaRoot, thumbRelCandidate)
    : null;
  const thumb_url = mediaUrlFromRelative(thumbRel) || full_url;

  return { thumb_url, full_url };
}

/**
 * @param {string} worksJsonPath
 * @returns {Map<string, string>}
 */
export function loadWorkMediaById(worksJsonPath) {
  const map = new Map();
  if (!fs.existsSync(worksJsonPath)) return map;
  const data = JSON.parse(fs.readFileSync(worksJsonPath, 'utf8'));
  for (const w of data.works || []) {
    if (w.id && w.media) map.set(w.id, String(w.media).replace(/\\/g, '/'));
  }
  return map;
}
