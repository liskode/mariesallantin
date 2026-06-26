/**
 * Extraction et normalisation des collectionneurs depuis titres / noms de fichier.
 */

export const COLLECTOR_NON_PRECISE = 'non précisé';

/** @type {{ pattern: RegExp, name: string, type: 'Galerie'|'Institutions'|'Particulier' }[]} */
const CANONICAL_RULES = [
  {
    pattern: /^(galerie\s+)?nicole\s+ferry$/i,
    name: 'Nicole Ferry',
    type: 'Galerie',
  },
  { pattern: /^nf$/i, name: 'Nicole Ferry', type: 'Galerie' },
  { pattern: /^col\s*(part)?\s*nf$/i, name: 'Nicole Ferry', type: 'Galerie' },
  {
    pattern: /^fnac$/i,
    name: "Fond National d'Art Contemporain",
    type: 'Institutions',
  },
  { pattern: /^colpart$/i, name: COLLECTOR_NON_PRECISE, type: 'Particulier' },
  { pattern: /^col\s*part$/i, name: COLLECTOR_NON_PRECISE, type: 'Particulier' },
  { pattern: /^col$/i, name: COLLECTOR_NON_PRECISE, type: 'Particulier' },
];

function normalizeText(text) {
  return String(text || '').normalize('NFC').trim();
}

/**
 * @param {string} rawName
 * @returns {{ name: string, collector_type: 'Galerie'|'Institutions'|'Particulier' }}
 */
export function canonicalizeCollector(rawName) {
  const trimmed = normalizeText(rawName).replace(/\s+/g, ' ');
  if (!trimmed) {
    return { name: COLLECTOR_NON_PRECISE, collector_type: 'Particulier' };
  }

  for (const rule of CANONICAL_RULES) {
    if (rule.pattern.test(trimmed)) {
      return { name: rule.name, collector_type: rule.type };
    }
  }

  const titleCase = trimmed
    .split(/\s+/)
    .map((w) =>
      w
        .split('-')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join('-')
    )
    .join(' ');

  return { name: titleCase, collector_type: 'Particulier' };
}

/**
 * Marqueurs explicites : *, Coll., col part, COLPART…
 * @param {string} text
 * @returns {string | null}
 */
export function extractCollectorRawFromTitle(text) {
  const t = normalizeText(text);
  if (!t) return null;

  const namePart = `[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ0-9\\s\\-'.]*`;

  const rules = [
    new RegExp(`(?:\\*|_)\\s*col\\s*part\\s+(${namePart})\\s*$`, 'i'),
    new RegExp(`(?:\\*|_)\\s*col\\s+(${namePart})\\s*$`, 'i'),
    new RegExp(`coll?\\.\\s*(${namePart})\\s*$`, 'i'),
    new RegExp(`col\\s*part\\s+(${namePart})\\s*$`, 'i'),
    /\*\s*(COLPART)\s*$/i,
    /\*\s*(COL)\s*$/i,
    /\*\s*col\s*part\s*$/i,
    new RegExp(`\\*\\s*(${namePart})\\s*$`, 'i'),
  ];

  for (const re of rules) {
    const m = re.exec(t);
    if (m && m[1] != null && String(m[1]).trim()) return String(m[1]).trim();
    if (m && m[0] && /\*\s*col\s*part\s*$/i.test(m[0])) return 'col part';
  }
  return null;
}

/**
 * Dernier segment après _ dans le nom de fichier (media), marqueurs explicites uniquement.
 * @param {string} basename
 * @returns {string | null}
 */
export function extractCollectorRawFromMediaBasename(basename) {
  const stem = normalizeText(basename).replace(/\.[^.]+$/i, '');
  const idx = stem.lastIndexOf('_');
  if (idx < 0) return null;

  const tail = stem.slice(idx + 1).trim();
  if (!tail) return null;

  const namePart = `[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ0-9\\s\\-'.]*`;

  const collMatch = new RegExp(`coll?\\.\\s*(${namePart})`, 'i').exec(tail);
  if (collMatch?.[1]) return collMatch[1].trim();

  const colPart = /^col\s*part\s+(.+)$/i.exec(tail);
  if (colPart) return colPart[1].trim();

  const colOnly = /^col\s+(.+)$/i.exec(tail);
  if (colOnly) return colOnly[1].trim();

  if (/^COLPART$/i.test(tail)) return 'COLPART';
  if (/^COL$/i.test(tail)) return 'COL';
  if (/^(FNAC|ROSSET)$/i.test(tail)) return tail.toUpperCase();

  if (/^(galerie\s+)?nicole\s+ferry$/i.test(tail)) return tail;
  if (/^galerie\s+/i.test(tail)) return tail;

  return null;
}

/**
 * @param {string} title
 * @param {string} [filenameOriginal]
 * @param {string} [mediaBasename]
 * @returns {{ name: string, collector_type: string } | null}
 */
export function parseCollectorForWork(title, filenameOriginal, mediaBasename) {
  const sources = [
    extractCollectorRawFromTitle(title),
    extractCollectorRawFromTitle(filenameOriginal),
    mediaBasename ? extractCollectorRawFromMediaBasename(mediaBasename) : null,
  ];

  for (const raw of sources) {
    if (raw != null && String(raw).trim()) return canonicalizeCollector(raw);
  }
  return null;
}
