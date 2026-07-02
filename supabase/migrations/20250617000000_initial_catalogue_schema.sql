-- =============================================================================
-- Catalogue Marie Sallantin — schéma Supabase (version unique, ordonnée)
-- =============================================================================
-- Clé œuvre stable : works.id = MS####
-- Image œuvre : convention {id}.jpeg (Storage ou site statique)
-- Seed : codes de référence uniquement (pas d’œuvres ni de médias liés)
--
-- Si une version antérieure de ce fichier a déjà été exécutée, ce script
-- supprime d’abord les objets connus puis recrée le schéma cible.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Nettoyage idempotent (ordre inverse des dépendances)
-- ---------------------------------------------------------------------------

drop table if exists public.related_media_series cascade;
drop table if exists public.related_media_works cascade;
drop table if exists public.related_media cascade;
drop table if exists public.work_series cascade;
drop table if exists public.works cascade;
drop table if exists public.media_types cascade;
drop table if exists public.publication_statuses cascade;
drop table if exists public.photo_statuses cascade;
drop table if exists public.techniques cascade;
drop table if exists public.formats cascade;
drop table if exists public.series cascade;

drop function if exists public.set_updated_at() cascade;

-- ---------------------------------------------------------------------------
-- Utilitaire : updated_at automatique
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tables de référence (structure cohérente)
-- code, label, sort_order, created_at, updated_at
-- ---------------------------------------------------------------------------

create table public.series (
  code text primary key check (code ~ '^[A-Z0-9]{2,12}$'),
  label text not null default '',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.formats (
  code text primary key check (char_length(code) = 4),
  label text not null default '',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.techniques (
  code text primary key check (char_length(code) = 3),
  label text not null default '',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.publication_statuses (
  code text primary key check (code ~ '^[A-Z0-9]{1,12}$'),
  label text not null default '',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.photo_statuses (
  code text primary key check (code ~ '^[A-Z0-9]{1,12}$'),
  label text not null default '',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.media_types (
  code text primary key check (code ~ '^[A-Z0-9]{1,12}$'),
  label text not null default '',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Œuvres
-- ---------------------------------------------------------------------------

create table public.works (
  id text primary key check (id ~ '^MS[0-9]{4}$'),
  title text not null default '',
  year smallint check (year is null or (year >= 1000 and year <= 9999)),
  format_code text references public.formats (code) on update cascade on delete set null,
  technique_code text references public.techniques (code) on update cascade on delete set null,
  publication_status_code text not null default 'N'
    references public.publication_statuses (code) on update cascade on delete restrict,
  photo_status_code text not null default 'OK'
    references public.photo_statuses (code) on update cascade on delete restrict,
  width_cm numeric(8, 2) check (width_cm is null or width_cm > 0),
  height_cm numeric(8, 2) check (height_cm is null or height_cm > 0),
  site_status text check (site_status is null or site_status in ('P', 'S')),
  sort_order int not null default 0,
  image_ext text not null default 'jpeg' check (image_ext in ('jpeg', 'jpg', 'png', 'webp')),
  width_px int check (width_px is null or width_px > 0),
  height_px int check (height_px is null or height_px > 0),
  file_size_bytes bigint check (file_size_bytes is null or file_size_bytes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.work_series (
  work_id text not null references public.works (id) on delete cascade,
  series_code text not null references public.series (code) on update cascade on delete restrict,
  primary key (work_id, series_code)
);

create index works_sort_order_idx on public.works (sort_order);
create index work_series_series_code_idx on public.work_series (series_code);

-- ---------------------------------------------------------------------------
-- Médias liés (presse, catalogues, livres, vidéos, audio…)
-- Liens optionnels vers une ou plusieurs œuvres et/ou séries
-- ---------------------------------------------------------------------------

create table public.related_media (
  id uuid primary key default gen_random_uuid(),
  media_type_code text not null
    references public.media_types (code) on update cascade on delete restrict,
  title text not null default '',
  media_date date,
  source text not null default '',
  description text not null default '',
  url text not null default '',
  publication_status_code text not null default 'N'
    references public.publication_statuses (code) on update cascade on delete restrict,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.related_media_works (
  media_id uuid not null references public.related_media (id) on delete cascade,
  work_id text not null references public.works (id) on delete cascade,
  primary key (media_id, work_id)
);

create table public.related_media_series (
  media_id uuid not null references public.related_media (id) on delete cascade,
  series_code text not null references public.series (code) on update cascade on delete restrict,
  primary key (media_id, series_code)
);

create index related_media_type_idx on public.related_media (media_type_code);
create index related_media_publication_idx on public.related_media (publication_status_code);
create index related_media_works_work_id_idx on public.related_media_works (work_id);
create index related_media_series_series_code_idx on public.related_media_series (series_code);

-- ---------------------------------------------------------------------------
-- Triggers updated_at
-- ---------------------------------------------------------------------------

create trigger series_set_updated_at
  before update on public.series
  for each row execute function public.set_updated_at();

create trigger formats_set_updated_at
  before update on public.formats
  for each row execute function public.set_updated_at();

create trigger techniques_set_updated_at
  before update on public.techniques
  for each row execute function public.set_updated_at();

create trigger publication_statuses_set_updated_at
  before update on public.publication_statuses
  for each row execute function public.set_updated_at();

create trigger photo_statuses_set_updated_at
  before update on public.photo_statuses
  for each row execute function public.set_updated_at();

create trigger media_types_set_updated_at
  before update on public.media_types
  for each row execute function public.set_updated_at();

create trigger works_set_updated_at
  before update on public.works
  for each row execute function public.set_updated_at();

create trigger related_media_set_updated_at
  before update on public.related_media
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Seed : codes de référence uniquement
-- ---------------------------------------------------------------------------

insert into public.series (code, label, sort_order) values
  ('ABSTR', 'Abstractions', 10),
  ('APHRO', 'Aphrodite', 20),
  ('ATELI', 'Atelier', 30),
  ('CIEUX', 'Cieux', 40),
  ('COMPA', 'Compagnie de Vénus', 45),
  ('DANAE', 'Danaé', 50),
  ('DANTE', 'Dante', 60),
  ('ENCRE', 'Encre de Chine', 70),
  ('ENFER', 'Enfer', 80),
  ('HIVER', 'Quatre saisons - Hiver', 85),
  ('JUGEM', 'Jugement dernier', 90),
  ('LICOR', 'Licorne', 95),
  ('MASQU', 'Masques, miroir et statuette', 100),
  ('METAM', 'Métamorphoses', 110),
  ('MUSEE', 'Musées', 120),
  ('NUITS', 'Nuits perdues', 130),
  ('POLYP', 'Polyptyques', 140),
  ('PURGA', 'Purgatoire', 150),
  ('RESUR', 'Résurrection', 160),
  ('UNIVE', 'Univers', 170)
on conflict (code) do update set
  label = excluded.label,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.formats (code, label, sort_order) values
  ('HF23', '200x300', 10),
  ('HF21', '210x', 20),
  ('HF03', '', 30),
  ('HF04', '', 40),
  ('HF05', '', 50),
  ('HF06', '', 60),
  ('HF07', '', 70),
  ('HF08', '', 80),
  ('HF09', '', 90)
on conflict (code) do update set
  label = excluded.label,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.techniques (code, label, sort_order) values
  ('TST', 'Tempera sur toile', 10),
  ('TSB', 'Tempera sur bois', 20),
  ('INK', 'Encre sur papier', 30),
  ('HUI', 'Huile sur toile', 40),
  ('AST', 'Acrylique sur toile', 50),
  ('ASB', 'Acrylique sur bois', 60)
on conflict (code) do update set
  label = excluded.label,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.publication_statuses (code, label, sort_order) values
  ('N', 'Non publiée', 10),
  ('C', 'Publiée dans le catalogue imprimé', 20),
  ('W', 'Publiée catalogue imprimé et site mariesallantin.art', 30)
on conflict (code) do update set
  label = excluded.label,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.photo_statuses (code, label, sort_order) values
  ('OK', 'OK', 10),
  ('HQ', 'Haute qualité', 20),
  ('LQ', 'Basse qualité', 30),
  ('REDO', 'À refaire', 40)
on conflict (code) do update set
  label = excluded.label,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.media_types (code, label, sort_order) values
  ('W', 'Lien web', 5),
  ('P', 'Article de presse', 10),
  ('X', 'Exposition / entretien d''exposition', 20),
  ('C', 'Catalogue / livre', 30),
  ('V', 'Vidéo', 40),
  ('A', 'Enregistrement audio', 50)
on conflict (code) do update set
  label = excluded.label,
  sort_order = excluded.sort_order,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- RLS : lecture publique (anon + authenticated)
-- ---------------------------------------------------------------------------

alter table public.series enable row level security;
alter table public.formats enable row level security;
alter table public.techniques enable row level security;
alter table public.publication_statuses enable row level security;
alter table public.photo_statuses enable row level security;
alter table public.media_types enable row level security;
alter table public.works enable row level security;
alter table public.work_series enable row level security;
alter table public.related_media enable row level security;
alter table public.related_media_works enable row level security;
alter table public.related_media_series enable row level security;

create policy "series_public_read"
  on public.series for select to anon, authenticated using (true);

create policy "formats_public_read"
  on public.formats for select to anon, authenticated using (true);

create policy "techniques_public_read"
  on public.techniques for select to anon, authenticated using (true);

create policy "publication_statuses_public_read"
  on public.publication_statuses for select to anon, authenticated using (true);

create policy "photo_statuses_public_read"
  on public.photo_statuses for select to anon, authenticated using (true);

create policy "media_types_public_read"
  on public.media_types for select to anon, authenticated using (true);

create policy "works_public_read"
  on public.works for select to anon, authenticated using (true);

create policy "work_series_public_read"
  on public.work_series for select to anon, authenticated using (true);

create policy "related_media_public_read"
  on public.related_media for select to anon, authenticated using (true);

create policy "related_media_works_public_read"
  on public.related_media_works for select to anon, authenticated using (true);

create policy "related_media_series_public_read"
  on public.related_media_series for select to anon, authenticated using (true);

-- Écriture : à brancher via auth éditeur ou Edge Function (service role).
