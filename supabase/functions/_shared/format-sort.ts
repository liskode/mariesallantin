/** Tri des formats : famille (F → P → C → M → autres), puis 3 premiers caractères du code. */

const FAMILY_ORDER = ['F', 'P', 'C', 'M'] as const;
const FAMILY_LABELS: Record<string, string> = {
  F: 'Figure',
  P: 'Paysage',
  C: 'Carré',
  M: 'Marine',
};

export function formatFamily(code: string): string {
  const last = String(code || '').trim().toUpperCase().slice(-1);
  if (last === 'F' || last === 'P' || last === 'C' || last === 'M') return last;
  return '_';
}

function familyOrderIndex(family: string): number {
  const i = FAMILY_ORDER.indexOf(family as (typeof FAMILY_ORDER)[number]);
  return i === -1 ? FAMILY_ORDER.length : i;
}

function codeOf(item: { code?: string } | string): string {
  return String(typeof item === 'string' ? item : item?.code || '')
    .trim()
    .toUpperCase();
}

export function compareFormatCodes(
  a: { code?: string } | string,
  b: { code?: string } | string
): number {
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

export function sortFormats<T extends { code: string }>(list: T[]): T[] {
  return [...(list || [])].sort(compareFormatCodes);
}
