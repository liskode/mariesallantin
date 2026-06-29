/**
 * Tri des formats : famille (F → P → C → autres), puis 3 premiers caractères du code.
 */

const FAMILY_ORDER = ['F', 'P', 'C'];
const FAMILY_LABELS = {
  F: 'Figure',
  P: 'Paysage',
  C: 'Carré',
};

/** @param {string} code */
export function formatFamily(code) {
  const last = String(code || '').trim().toUpperCase().slice(-1);
  if (last === 'F' || last === 'P' || last === 'C') return last;
  return '_';
}

/** @param {string} family */
function familyOrderIndex(family) {
  const i = FAMILY_ORDER.indexOf(family);
  return i === -1 ? FAMILY_ORDER.length : i;
}

/** @param {{ code?: string } | string} item */
function codeOf(item) {
  return String(typeof item === 'string' ? item : item?.code || '')
    .trim()
    .toUpperCase();
}

/**
 * @param {{ code?: string } | string} a
 * @param {{ code?: string } | string} b
 */
export function compareFormatCodes(a, b) {
  const ca = codeOf(a);
  const cb = codeOf(b);
  const fa = formatFamily(ca);
  const fb = formatFamily(cb);
  const oa = familyOrderIndex(fa);
  const ob = familyOrderIndex(fb);
  if (oa !== ob) return oa - ob;

  if (fa === '_' && fb === '_') {
    const lastCmp = ca.slice(-1).localeCompare(cb.slice(-1), 'fr');
    if (lastCmp !== 0) return lastCmp;
  }

  const prefixCmp = ca.slice(0, 3).localeCompare(cb.slice(0, 3), 'fr', { numeric: true });
  if (prefixCmp !== 0) return prefixCmp;
  return ca.localeCompare(cb, 'fr');
}

/** @param {Array<{ code: string }>} list */
export function sortFormats(list) {
  return [...(list || [])].sort(compareFormatCodes);
}

/**
 * @param {Array<{ code: string }>} list
 * @returns {Array<{ family: string, label: string | null, items: Array<object> }>}
 */
export function groupFormatsByFamily(list) {
  const sorted = sortFormats(list);
  /** @type {Map<string, object[]>} */
  const buckets = new Map();

  for (const item of sorted) {
    const fam = formatFamily(item.code);
    const key = fam === 'F' || fam === 'P' || fam === 'C' ? fam : '_';
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(item);
  }

  /** @type {Array<{ family: string, label: string | null, items: object[] }>} */
  const groups = [];
  for (const key of [...FAMILY_ORDER, '_']) {
    const items = buckets.get(key);
    if (!items?.length) continue;
    groups.push({
      family: key,
      label: FAMILY_LABELS[key] || null,
      items,
    });
  }
  return groups;
}
