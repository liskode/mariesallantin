/**
 * PostgREST renvoie au plus 1000 lignes par requête : lit une liste complète par tranches.
 * La requête doit avoir un ordre stable (order sur une clé unique) pour que les tranches ne se chevauchent pas.
 * Usage : fetchAll((from, to) => supabase.from('work_series').select('…').order('work_id').order('series_code').range(from, to))
 */
const PAGE_SIZE = 1000;

// deno-lint-ignore no-explicit-any
export async function fetchAll<T = any>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}
