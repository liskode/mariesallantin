/**
 * Formats carrés : ancien code 4 chiffres (cm avec zéros) → ###C
 * Ex. 0020 → 020C, libellé « Format carré (20cm x 20cm) »
 */

/** @param {string} code */
export function isNumericSquareFormatCode(code) {
  return /^[0-9]{4}$/.test(String(code || '').trim());
}

/** @param {string} code */
export function isSquareFormatCode(code) {
  return /^[0-9]{3}C$/.test(String(code || '').trim().toUpperCase());
}

/**
 * @param {string} oldCode code 4 chiffres (ex. 0020)
 */
export function squareFormatFromNumericCode(oldCode) {
  const raw = String(oldCode || '').trim();
  const cm = parseInt(raw, 10);
  if (!Number.isFinite(cm) || cm <= 0) {
    throw new Error(`Code carré invalide : ${oldCode}`);
  }
  const newCode = String(cm).padStart(3, '0') + 'C';
  const label = `Format carré (${cm}cm x ${cm}cm)`;
  return {
    oldCode: raw,
    newCode,
    label,
    cm,
    height_cm: cm,
    width_cm: cm,
  };
}

/**
 * Normalise un code format (ancien 4 chiffres carré → ###C).
 * @param {string | null | undefined} code
 * @returns {string | null}
 */
export function normalizeSquareFormatCode(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return null;
  if (isSquareFormatCode(c)) return c;
  if (isNumericSquareFormatCode(c)) return squareFormatFromNumericCode(c).newCode;
  return c;
}
