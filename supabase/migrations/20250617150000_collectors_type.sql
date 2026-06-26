-- Type de collectionneur : Galerie | Institutions | Particulier
-- Idempotent : relançable sans erreur.

alter table public.collectors
  add column if not exists collector_type text not null default 'Particulier';

alter table public.collectors
  drop constraint if exists collectors_collector_type_check;

alter table public.collectors
  add constraint collectors_collector_type_check
  check (collector_type in ('Galerie', 'Institutions', 'Particulier'));

comment on column public.collectors.collector_type is
  'Galerie, Institutions (ex. FNAC) ou Particulier.';

-- Collectionneurs canoniques connus (upsert sans écraser les fiches déjà enrichies)
insert into public.collectors (name, collector_type, notes) values
  ('Nicole Ferry', 'Galerie', 'Alias : NF, Galerie Nicole Ferry, *col NF, col part NF'),
  ('Fond National d''Art Contemporain', 'Institutions', 'Alias : FNAC'),
  ('non précisé', 'Particulier', 'Provenance indiquée sans nom de collectionneur')
on conflict (name) do update set
  collector_type = excluded.collector_type,
  notes = case
    when public.collectors.notes = '' then excluded.notes
    else public.collectors.notes
  end,
  updated_at = now();
