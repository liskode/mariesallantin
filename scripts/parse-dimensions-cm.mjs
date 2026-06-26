/**
 * Extrait largeur × hauteur (cm) depuis un texte de titre / légende.
 * Gère O/o confondus avec 0 dans les chiffres (ex. 300X22Ocm → 300 × 220).
 */

/** @type {RegExp[]} ordre : du plus explicite au plus permissif */
export const DIMENSION_CM_PATTERNS = [
  /(\d[\dOo.,]*)\s*[xX×]\s*(\d[\dOo.,]*)cm\b/gi,
  /(\d[\dOo.,]*)cm\s*[xX×]\s*(\d[\dOo.,]*)cm\b/gi,
  /(\d[\dOo.,]*)\s*[xX×]\s*(\d[\dOo.,]*)cml\b/gi,
];

/** @deprecated alias interne */
const DIM_PATTERNS = DIMENSION_CM_PATTERNS;

/**
 * @param {string} raw
 * @returns {{ width_cm: number, height_cm: number } | null}
 */
export function parseDimensionsCmFromText(raw) {
  const text = String(raw || '');
  if (!text) return null;

  let last = null;
  for (const pattern of DIM_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    let m;
    while ((m = re.exec(text)) !== null) {
      const w = normalizeDimNumber(m[1]);
      const h = normalizeDimNumber(m[2]);
      if (w != null && h != null && w > 0 && h > 0) {
        last = { width_cm: w, height_cm: h };
      }
    }
  }
  return last;
}

/**
 * @param {string} title
 * @param {string} [filenameOriginal]
 */
export function parseDimensionsCmForWork(title, filenameOriginal) {
  return (
    parseDimensionsCmFromText(title) ||
    parseDimensionsCmFromText(filenameOriginal) ||
    null
  );
}

/**
 * Retire les motifs largeur × hauteur (cm) d’un titre.
 * @param {string} raw
 */
export function stripDimensionsCmFromText(raw) {
  let t = String(raw || '');
  if (!t) return t;

  for (const pattern of DIMENSION_CM_PATTERNS) {
    t = t.replace(new RegExp(pattern.source, pattern.flags), ' ');
  }

  t = t.replace(/\s+/g, ' ').trim();
  t = t.replace(/\s*[,;_\-–—]+\s*$/g, '').trim();
  t = t.replace(/\s+([,.;:])/g, '$1').trim();
  return t;
}

function normalizeDimNumber(token) {
  let s = String(token || '').trim();
  if (!s) return null;
  s = s.replace(/O/g, '0').replace(/o/g, '0');
  s = s.replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  if (Number.isNaN(n) || n <= 0 || n > 99999) return null;
  return Math.round(n * 100) / 100;
}
