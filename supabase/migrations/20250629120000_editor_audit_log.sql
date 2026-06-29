-- Journal des modifications éditeur (lecture admin via API service role).

create table public.editor_audit_log (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  editor_role text not null check (editor_role in ('artist', 'admin')),
  action_type text not null check (action_type in ('save', 'delete')),
  entity_type text not null check (
    entity_type in ('work', 'series', 'format', 'technique', 'collector')
  ),
  entity_key text not null,
  snapshot_before jsonb
);

create index editor_audit_log_created_at_idx
  on public.editor_audit_log (created_at desc);

comment on table public.editor_audit_log is
  'Historique des enregistrements et suppressions dans les éditeurs catalogue.';

alter table public.editor_audit_log enable row level security;
