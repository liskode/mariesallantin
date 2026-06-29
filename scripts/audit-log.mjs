/**
 * Journalisation des actions éditeur (enregistrement / suppression).
 */

/** @param {import('@supabase/supabase-js').SupabaseClient} supabase */
export async function logEditorAction(supabase, entry) {
  const { error } = await supabase.from('editor_audit_log').insert({
    editor_role: entry.editor_role,
    action_type: entry.action_type,
    entity_type: entry.entity_type,
    entity_key: entry.entity_key,
    snapshot_before: entry.snapshot_before ?? null,
  });
  if (error) console.error('[audit-log]', error.message);
}

/** @param {import('@supabase/supabase-js').SupabaseClient} supabase @param {number} [limit] */
export async function fetchAuditLog(supabase, limit = 500) {
  const { data, error } = await supabase
    .from('editor_audit_log')
    .select('id, created_at, editor_role, action_type, entity_type, entity_key, snapshot_before')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}
