-- Collectors (privé), work_messages, statut publication M, lien acquéreur sur works.
-- Idempotent : relançable sur un projet déjà migré.

insert into public.publication_statuses (code, label, sort_order) values
  ('M', 'À valider manuellement (import avec avertissements)', 15)
on conflict (code) do update set
  label = excluded.label,
  sort_order = excluded.sort_order,
  updated_at = now();

create table if not exists public.collectors (
  name text primary key,
  first_name text not null default '',
  phone text not null default '',
  email text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists collectors_set_updated_at on public.collectors;
create trigger collectors_set_updated_at
  before update on public.collectors
  for each row execute function public.set_updated_at();

alter table public.works
  add column if not exists collector_name text references public.collectors (name)
    on update cascade on delete set null;

create table if not exists public.work_messages (
  id uuid primary key default gen_random_uuid(),
  work_id text not null references public.works (id) on delete cascade,
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists work_messages_work_id_idx on public.work_messages (work_id);

alter table public.collectors enable row level security;
alter table public.work_messages enable row level security;

drop policy if exists "work_messages_public_read" on public.work_messages;
create policy "work_messages_public_read"
  on public.work_messages for select to anon, authenticated using (true);

-- collectors : pas de policy SELECT → lecture refusée pour anon/authenticated (service role OK).
