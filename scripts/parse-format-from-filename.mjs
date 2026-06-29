/**
 * Extrait format_code depuis un nom de fichier catalogue MS####_…
 * Règle : token alphanumérique 4 caractères encadré par « _ » (hors années 19xx/20xx).
 */
import { stripAccents } from '../legend-filename.mjs';
import { normalizeSquareFormatCode } from './square-format-codes.mjs';

const YEAR_RE = /^(19|20)\d{2}$/;

const NON_FORMAT_CODES = new Set(['META', 'FNAC', 'ZEUS', 'OFFF', 'OFF', 'VAL', 'BERG']);

function normalizeStem(stem) {
  return stripAccents(String(stem || '')).toUpperCase();
}

/** @returns {string[]} segments _…_ du stem (sans extension), accents retirés, majuscules */
function stemParts(stem) {
  return normalizeStem(stem).split('_').map((p) => p.trim()).filter(Boolean);
}

function tokenToCode(raw) {
  return raw.replace(/[^A-Z0-9]/g, '');
}

/** @returns {string[]} codes uniques dans l'ordre d'apparition */
export function extractFormatCodeCandidates(stem) {
  const hits = [];
  const seen = new Set();
  for (const raw of stemParts(stem)) {
    const code = tokenToCode(raw);
    if (code.length !== 4) continue;
    if (YEAR_RE.test(code) || seen.has(code)) continue;
    seen.add(code);
    hits.push(code);
  }
  return hits;
}

/** Token 4 car. immédiatement avant une année dans la séquence _…_ */
export function formatCodeBeforeYear(stem) {
  const parts = stemParts(stem);
  for (let i = 0; i < parts.length; i++) {
    const yearCode = tokenToCode(parts[i]);
    if (!YEAR_RE.test(yearCode)) continue;
    for (let j = i - 1; j >= 0; j--) {
      const code = tokenToCode(parts[j]);
      if (code.length === 4 && !YEAR_RE.test(code) && !NON_FORMAT_CODES.has(code)) {
        return code;
      }
    }
  }
  return null;
}

export function isFormatLikeCode(code) {
  return (
    /^\d{3}[FP]$/.test(code) ||
    /^\d{3}C$/.test(code) ||
    /^HF\d{2}$/.test(code) ||
    /^HOFO$/.test(code) ||
    /^0HF0$/.test(code) ||
    /^0[A-Z0-9]{3}$/.test(code) ||
    /^\d{4}$/.test(code)
  );
}

/**
 * @param {string} stem nom sans extension
 * @returns {string | null}
 */
export function pickFormatCodeFromStem(stem) {
  const beforeYear = formatCodeBeforeYear(stem);
  if (beforeYear) return normalizeSquareFormatCode(beforeYear);

  const hits = extractFormatCodeCandidates(stem);
  if (hits.length === 0) return null;
  if (hits.length === 1) {
    const code = NON_FORMAT_CODES.has(hits[0]) ? null : hits[0];
    return code ? normalizeSquareFormatCode(code) : null;
  }

  const formatLike = hits.filter(isFormatLikeCode);
  if (formatLike.length === 1) return normalizeSquareFormatCode(formatLike[0]);

  const filtered = hits.filter((h) => !NON_FORMAT_CODES.has(h));
  if (filtered.length === 1) return normalizeSquareFormatCode(filtered[0]);

  const picked = formatLike[0] || filtered[0] || hits[hits.length - 1];
  return picked ? normalizeSquareFormatCode(picked) : null;
}

/**
 * @param {string} basename nom de fichier avec extension
 * @returns {{ formatCode: string | null, filenameOriginal: string, imageExt: string | null }}
 */
export function parseFormatFromBasename(basename) {
  const name = String(basename || '').trim();
  const lastDot = name.lastIndexOf('.');
  const stem = lastDot === -1 ? name : name.slice(0, lastDot);
  const extRaw = lastDot === -1 ? '' : name.slice(lastDot + 1).toLowerCase();
  const imageExt = ['jpeg', 'jpg', 'png', 'webp'].includes(extRaw) ? extRaw : null;

  return {
    formatCode: pickFormatCodeFromStem(stem),
    filenameOriginal: name,
    imageExt,
  };
}
