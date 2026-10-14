/**
 * Décodage tolérant des noms de fichiers d'export (photothèque) :
 * cherche séries, année, format et technique n'importe où dans le nom, puis garde le reste comme titre.
 * Ex. « 060-2001-COMPA-T:T Cie de Vénus "tête à tête" 2001tempera sur toile 60x60cm-3 »
 *   → séries COMPA, année 2001, technique TST, titre « Cie de Vénus "tête à tête" … ».
 */

/** Abréviations de technique écrites en deux lettres séparées (T-T, T:T, A/T…). */
const TECHNIQUE_PAIRS = { 'T T': 'TST', 'A T': 'AST', 'H T': 'HST', 'A B': 'ASB', 'T B': 'TSB' };

const YEAR_RE = /^(19[4-9]\d|20[0-3]\d)$/;

/**
 * @param {string} filename
 * @param {{ series: Set<string>, formats: Set<string>, techniques: Set<string> }} known
 */
export function parseExportFilename(filename, known) {
  let stem = String(filename || '').replace(/\.[a-z0-9]+$/i, '').replace(/\.(jpe?g|png|tiff?)$/i, '');
  stem = stem.replace(/\s*\((\d+|bis|ter|quater)\)\s*$/i, '').replace(/[-_ ]\d{1,2}$/, '');

  // Techniques en deux lettres (T-T, T:T, A/T) avant découpage
  let technique = null;
  stem = stem.replace(/(^|[-_\s])([TAH])\s*[-:/]\s*([TB])(?=$|[-_\s])/i, (m, pre, x, y) => {
    const code = TECHNIQUE_PAIRS[(x + ' ' + y).toUpperCase()];
    if (!code) return m;
    technique = code;
    return pre + ' ';
  });

  const tokens = stem.split(/[-_:]+/).map((t) => t.trim()).filter(Boolean);
  const series = [];
  let year = null;
  let format = null;
  const rest = [];
  for (const tok of tokens) {
    const u = tok.toUpperCase();
    if (known.series.has(u)) {
      if (!series.includes(u)) series.push(u);
      continue;
    }
    if (u === 'PHOTO' || u === 'X') continue;
    if (!year && YEAR_RE.test(u)) {
      year = parseInt(u, 10);
      continue;
    }
    if (!format && known.formats.has(u)) {
      format = u;
      continue;
    }
    if (!format && /^\d{3}$/.test(u) && known.formats.has('0' + u)) {
      format = '0' + u;
      continue;
    }
    if (!technique && known.techniques.has(u)) {
      technique = u;
      continue;
    }
    rest.push(tok);
  }

  // Titre : segments contenant du texte (minuscules ou phrase), sans les codes isolés
  let title = rest
    .filter((t) => /[a-zàâäéèêëïîôùûüç]/.test(t) || /\s/.test(t))
    .join(' — ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!year) {
    const m = title.match(/\b(19[4-9]\d|20[0-3]\d)\b/);
    if (m) year = parseInt(m[1], 10);
  }
  if (/^(img|dsc|dscn|p\d{5,})/i.test(stem.trim())) title = '';
  return { series, year, format, technique, title };
}
