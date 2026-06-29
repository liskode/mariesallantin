import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

export type AuditAction = 'save' | 'delete';
export type AuditEntity = 'work' | 'series' | 'format' | 'technique' | 'collector';

export async function logEditorAction(
  supabase: SupabaseClient,
  entry: {
    editor_role: string;
    action_type: AuditAction;
    entity_type: AuditEntity;
    entity_key: string;
    snapshot_before: Record<string, unknown> | null;
  }
): Promise<void> {
  const { error } = await supabase.from('editor_audit_log').insert({
    editor_role: entry.editor_role,
    action_type: entry.action_type,
    entity_type: entry.entity_type,
    entity_key: entry.entity_key,
    snapshot_before: entry.snapshot_before,
  });
  if (error) console.error('[audit-log]', error.message);
}

export async function fetchAuditLog(supabase: SupabaseClient, limit = 500) {
  const { data, error } = await supabase
    .from('editor_audit_log')
    .select('id, created_at, editor_role, action_type, entity_type, entity_key, snapshot_before')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}
