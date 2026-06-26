/**
 * Utilitaires collectionneurs Supabase (code COL#### stable, nom éditable).
 */

const CODE_RE = /^COL(\d+)$/i;

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {Promise<string>}
 */
export async function nextCollectorCode(supabase) {
  const { data, error } = await supabase
    .from('collectors')
    .select('code')
    .order('code', { ascending: false })
    .limit(50);

  if (error) throw error;

  let max = 0;
  for (const row of data || []) {
    const m = CODE_RE.exec(String(row.code || ''));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return 'COL' + String(max + 1).padStart(4, '0');
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} name
 * @returns {Promise<string | null>}
 */
export async function collectorCodeByName(supabase, name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;

  const { data, error } = await supabase
    .from('collectors')
    .select('code')
    .eq('name', trimmed)
    .maybeSingle();

  if (error) throw error;
  return data?.code ?? null;
}

/**
 * Crée le collectionneur s'il n'existe pas ; retourne le code.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ name: string, collector_type?: string }} spec
 * @param {Map<string, string>} cache name → code
 * @returns {Promise<string | null>}
 */
export async function ensureCollectorByName(supabase, spec, cache) {
  const name = String(spec.name || '').trim();
  if (!name) return null;

  if (cache.has(name)) return cache.get(name);

  const existing = await collectorCodeByName(supabase, name);
  if (existing) {
    cache.set(name, existing);
    return existing;
  }

  const code = await nextCollectorCode(supabase);
  const { error } = await supabase.from('collectors').insert({
    code,
    name,
    collector_type: spec.collector_type || 'Particulier',
    first_name: '',
    phone: '',
    email: '',
    notes: '',
  });
  if (error) throw error;

  cache.set(name, code);
  return code;
}
