/**
 * Règles noms de fichiers catalogue (partagé build Node + page éditeur navigateur en type=module).
 * Légende = du dernier tiret jusqu’à l’extension. Tirets « interdits » dans la légende (entre 2 majuscules ASCII) → cadratin U+2013.
 * Codes série : 5 caractères alphanum. + tiret, sauf PHOTO- (statut prise de vue).
 * Publication : préfixe OFF- (non publié), VAL- (à valider), sinon ON (pas de préfixe).
 */

export function stripAccents(s) {
  return String(s)
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

/** Légende = sous-chaîne après le dernier « - » du nom sans extension. */
export function extractLegendFromBasename(basename) {
  const lastDot = basename.lastIndexOf('.');
  const base = lastDot === -1 ? basename : basename.slice(0, lastDot);
  const li = base.lastIndexOf('-');
  const raw = li >= 0 ? base.slice(li + 1) : base;
  return normalizeLegendHyphens(raw.trim());
}

/** Tiret entre deux majuscules LATINES uniquement → cadratin (pas un séparateur de codes). */
export function normalizeLegendHyphens(legend) {
  return String(legend).replace(/([A-Z])-([A-Z])/g, '$1\u2013$2');
}

export function filenameSafeLegend(legend) {
  let s = normalizeLegendHyphens(String(legend).trim());
  s = s.replace(/[\/\\?%*:|"<>]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/** Préfixe optionnel d’inventaire : MS0001- / MS0001_ / MS0001 (espace) … */
export function stripCatalogueIdPrefix(s) {
  return String(s).replace(/^MS\d{4}[\s_-]+/i, '');
}

/**
 * Coupe la partie après MS#### : corps (codes / technique) vs légende.
 * On prend le dernier « _ » suivi du début d’un libellé (lettre), sinon le dernier « _ ».
 */
export function splitUnderscoreCatalogueAfterMs(afterMs) {
  const s = String(afterMs).trim();
  let splitIdx = -1;
  const re = /_(?=\s*[a-zA-ZàâäéèêëïîôùûüçœÆæ])/g;
  let m;
  while ((m = re.exec(s)) !== null) splitIdx = m.index;
  if (splitIdx >= 0) {
    return {
      bodySansLegend: s.slice(0, splitIdx),
      legend: normalizeLegendHyphens(s.slice(splitIdx + 1).trim()),
    };
  }
  const li = s.lastIndexOf('_');
  if (li >= 0) {
    return {
      bodySansLegend: s.slice(0, li),
      legend: normalizeLegendHyphens(s.slice(li + 1).trim()),
    };
  }
  return { bodySansLegend: '', legend: normalizeLegendHyphens(s) };
}

/** Liste works_numero (underscores) : légende selon splitUnderscoreCatalogueAfterMs. */
export function extractLegendFromUnderscoreCatalogue(basename) {
  const lastDot = basename.lastIndexOf('.');
  const stem = lastDot === -1 ? basename : basename.slice(0, lastDot);
  const afterMs = stripCatalogueIdPrefix(stem);
  return splitUnderscoreCatalogueAfterMs(afterMs).legend;
}

export function parsePublishFromBasename(baseNoExt) {
  let rest = stripCatalogueIdPrefix(baseNoExt);
  if (/^offf-/i.test(rest)) return { publish: 'OFF', rest: rest.slice(5) };
  if (/^off-/i.test(rest)) return { publish: 'OFF', rest: rest.slice(4) };
  if (/^val-/i.test(rest)) return { publish: 'VAL', rest: rest.slice(4) };
  return { publish: 'ON', rest };
}

export function stripPhotoPrefix(rest) {
  if (/^photo-/i.test(rest)) return { hasPhoto: true, rest: rest.slice(6) };
  return { hasPhoto: false, rest };
}

export const NOT_SERIES_CODES = new Set([
  'TOILE',
  'PAPIER',
  'PARTI',
  'CHINE',
  'COLNF',
  'AGNES',
  'ENCOU',
  'PARTN',
  'ELUSY',
  'BRUNO',
  'ROSSE',
  'TRICH',
  'MILMA',
  'SREAD',
  'REHAU',
  'COLPA',
  'COLAG',
  'NICOL',
  'FERRY',
  'GELIS',
  'MATHI',
  'GYRDD',
  'MATIS',
  'PICAS',
  'GAUGU',
  'GAUGI',
  'SIGNO',
  'BOTTU',
  'BOTTE',
]);

/**
 * Codes série : occurrence de exactement 5 caractères [A-Z0-9] suivis d’un tiret, sauf PHOTO- et codes exclus.
 */
export function extractSeriesCodesFromBase(baseNoExt) {
  const u = stripAccents(baseNoExt).toUpperCase();
  const codes = new Set();
  const re = /(^|[-_])([A-Z0-9]{5})-/g;
  let m;
  while ((m = re.exec(u)) !== null) {
    const code = m[2];
    if (code === 'PHOTO') continue;
    if (/^[0-9]{5}$/.test(code)) continue;
    if (NOT_SERIES_CODES.has(code)) continue;
    codes.add(code);
  }
  if (u.includes('ENCOURS')) codes.add('ENCOURS');
  return [...codes].sort();
}

export function photoStatusFromBase(baseNoExt) {
  const woId = stripCatalogueIdPrefix(baseNoExt);
  const compact = stripAccents(woId).toUpperCase().replace(/\s+/g, '');
  if (compact.startsWith('PHOTO')) return 'Redo';
  const tokens = woId.split(/[-_]+/).map((s) =>
    stripAccents(s.trim())
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
  );
  if (tokens.includes('PHOTO')) return 'Redo';
  if (/(^|[^A-Z0-9])PHOTO([^A-Z0-9]|$)/.test(compact)) return 'Redo';
  return 'OK';
}

export function getExtensionWithDot(basename) {
  const lastDot = basename.lastIndexOf('.');
  return lastDot === -1 ? '' : basename.slice(lastDot);
}

export function stemPrefixBeforeLegend(basename) {
  const lastDot = basename.lastIndexOf('.');
  const base = lastDot === -1 ? basename : basename.slice(0, lastDot);
  const li = base.lastIndexOf('-');
  return li >= 0 ? base.slice(0, li) : '';
}

/** True si nom de type works_numero : MS0001_… avec séparateurs _. */
export function isUnderscoreMsCatalogueStem(stem) {
  return /^MS\d{4}[_\s]/i.test(String(stem)) && /_/.test(String(stem));
}

/**
 * Découpe un nom de fichier pour l’éditeur : préserve le segment médian (codes, années, etc.)
 * entre [OFF-|VAL-][PHOTO-] et la légende (après le dernier tiret).
 */
export function splitBasenameForEditor(basename) {
  const ext = getExtensionWithDot(basename);
  const lastDot = basename.lastIndexOf('.');
  const baseNoExt = lastDot === -1 ? basename : basename.slice(0, lastDot);

  if (isUnderscoreMsCatalogueStem(baseNoExt)) {
    const afterMs = stripCatalogueIdPrefix(baseNoExt);
    const { bodySansLegend, legend } = splitUnderscoreCatalogueAfterMs(afterMs);
    const msMatch = baseNoExt.match(/^(MS\d{4}[\s_-]+)/i);
    const cataloguePrefix = msMatch ? msMatch[1] : '';
    const hb = bodySansLegend.replace(/_/g, '-');
    const { publish, rest: r1 } = parsePublishFromBasename(hb);
    const { hasPhoto } = stripPhotoPrefix(r1);
    let middleOpaque = bodySansLegend;
    if (/^offf_/i.test(middleOpaque)) middleOpaque = middleOpaque.slice(5);
    else if (/^off_/i.test(middleOpaque)) middleOpaque = middleOpaque.slice(4);
    else if (/^val_/i.test(middleOpaque)) middleOpaque = middleOpaque.slice(4);
    if (/^photo_/i.test(middleOpaque)) middleOpaque = middleOpaque.slice(6);
    return {
      publish,
      hasPhoto,
      middleOpaque,
      legend,
      ext,
      baseNoExt,
      cataloguePrefix,
      fileSeparator: '_',
    };
  }

  const li = baseNoExt.lastIndexOf('-');
  const legendRaw = li >= 0 ? baseNoExt.slice(li + 1) : baseNoExt;
  const legend = normalizeLegendHyphens(String(legendRaw).trim());
  const headBeforeLegend = li >= 0 ? baseNoExt.slice(0, li) : baseNoExt;

  const msMatch = headBeforeLegend.match(/^(MS\d{4}[\s_-]+)/i);
  const cataloguePrefix = msMatch ? msMatch[1] : '';

  const { publish, rest: afterPub } = parsePublishFromBasename(headBeforeLegend);
  const { hasPhoto, rest: afterPhoto } = stripPhotoPrefix(afterPub);
  const middleOpaque = afterPhoto;

  return {
    publish,
    hasPhoto,
    middleOpaque,
    legend,
    ext,
    baseNoExt,
    cataloguePrefix,
    fileSeparator: '-',
  };
}

/** Reconstruit le nom de fichier à partir des champs éditeur (segment médian inchangé si non modifié). */
export function rebuildFromEditorParts({
  cataloguePrefix = '',
  publish,
  hasPhoto,
  middleOpaque,
  legend,
  ext,
  fileSeparator,
}) {
  const sep = fileSeparator || (cataloguePrefix && /MS\d{4}_/i.test(cataloguePrefix) ? '_' : '-');
  let head = cataloguePrefix || '';
  if (publish === 'OFF') head += sep === '_' ? 'OFF_' : 'OFF-';
  else if (publish === 'VAL') head += sep === '_' ? 'VAL_' : 'VAL-';
  if (hasPhoto) head += sep === '_' ? 'PHOTO_' : 'PHOTO-';
  head += middleOpaque == null ? '' : String(middleOpaque);
  const leg = filenameSafeLegend(legend);
  if (!head) return leg + ext;
  if (sep === '_' && !String(middleOpaque || '').trim() && head.endsWith('_')) {
    return head + leg + ext;
  }
  return head + sep + leg + ext;
}
