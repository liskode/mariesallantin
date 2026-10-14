-- Indice de qualité des photos, photos in situ rattachées aux œuvres, doublons possibles.
-- Migration additive : aucune donnée existante n'est modifiée.

-- 1. Indice de qualité (0–100) de la photo de référence d'une œuvre
alter table public.works
  add column if not exists image_quality smallint
    check (image_quality is null or (image_quality >= 0 and image_quality <= 100)),
  add column if not exists image_quality_details jsonb;

comment on column public.works.image_quality is
  'Indice de qualité de la photo (0 = mauvaise, 100 = excellente) : 40 % netteté, 40 % compression, 20 % résolution.';
comment on column public.works.image_quality_details is
  'Mesures brutes : largeur/hauteur px, mégapixels, bits par pixel, variance du laplacien.';

-- 2. Photos in situ (atelier, exposition, chez un collectionneur) : hors catalogue raisonné,
--    rattachées à une ou plusieurs œuvres.
create table if not exists public.situ_photo_types (
  code text primary key,
  label text not null,
  sort_order int not null default 0
);

insert into public.situ_photo_types (code, label, sort_order) values
  ('A', 'Atelier', 10),
  ('E', 'Exposition', 20),
  ('C', 'Chez un collectionneur', 30),
  ('X', 'Autre', 40)
on conflict (code) do update set label = excluded.label, sort_order = excluded.sort_order;

create table if not exists public.situ_photos (
  id uuid primary key default gen_random_uuid(),
  file_path text not null,
  type_code text not null default 'A'
    references public.situ_photo_types (code) on update cascade on delete restrict,
  caption text not null default '',
  photo_date date,
  source_filename text,
  image_quality smallint check (image_quality is null or (image_quality >= 0 and image_quality <= 100)),
  width_px int check (width_px is null or width_px > 0),
  height_px int check (height_px is null or height_px > 0),
  file_sha256 text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.situ_photos.file_path is 'Chemin relatif au site (media/situ/…)';

create table if not exists public.situ_photo_works (
  photo_id uuid not null references public.situ_photos (id) on delete cascade,
  work_id text not null references public.works (id) on update cascade on delete cascade,
  primary key (photo_id, work_id)
);

create index if not exists situ_photo_works_work_idx on public.situ_photo_works (work_id);

-- 3. Doublons possibles entre œuvres (distance visuelle Vision) et décisions « pas un doublon »
create table if not exists public.work_similarities (
  work_a text not null references public.works (id) on update cascade on delete cascade,
  work_b text not null references public.works (id) on update cascade on delete cascade,
  distance real not null,
  status text not null default 'open' check (status in ('open', 'dismissed')),
  updated_at timestamptz not null default now(),
  primary key (work_a, work_b),
  check (work_a < work_b)
);

create index if not exists work_similarities_open_idx
  on public.work_similarities (distance) where status = 'open';

-- Lecture publique (comme works / work_series) ; écriture via Edge Functions (service role).
alter table public.situ_photo_types enable row level security;
alter table public.situ_photos enable row level security;
alter table public.situ_photo_works enable row level security;
alter table public.work_similarities enable row level security;

drop policy if exists "situ_photo_types_public_read" on public.situ_photo_types;
create policy "situ_photo_types_public_read"
  on public.situ_photo_types for select to anon, authenticated using (true);

drop policy if exists "situ_photos_public_read" on public.situ_photos;
create policy "situ_photos_public_read"
  on public.situ_photos for select to anon, authenticated using (true);

drop policy if exists "situ_photo_works_public_read" on public.situ_photo_works;
create policy "situ_photo_works_public_read"
  on public.situ_photo_works for select to anon, authenticated using (true);

-- work_similarities : pas de lecture publique (outil éditeur uniquement, via service role).
