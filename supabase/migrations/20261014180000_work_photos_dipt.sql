-- « Photos in situ » deviennent « autres photos » d'une œuvre (atelier, exposition, collectionneur,
-- combinaison de tableaux, détail…). Les tables créées le 14/10/2026 sont encore vides : on les remplace.
-- Format DYPT renommé DIPT (orthographe) ; les œuvres suivent (clé étrangère « on update cascade »).

drop table if exists public.situ_photo_works;
drop table if exists public.situ_photos;
drop table if exists public.situ_photo_types;

create table public.work_photo_types (
  code text primary key,
  label text not null,
  sort_order int not null default 0
);

insert into public.work_photo_types (code, label, sort_order) values
  ('A', 'Atelier', 10),
  ('E', 'Exposition', 20),
  ('C', 'Chez un collectionneur', 30),
  ('M', 'Combinaison de tableaux', 40),
  ('D', 'Détail', 50),
  ('X', 'Autre', 90);

create table public.work_photos (
  id uuid primary key default gen_random_uuid(),
  file_path text not null,
  type_code text not null default 'X'
    references public.work_photo_types (code) on update cascade on delete restrict,
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

comment on table public.work_photos is
  'Autres photos des œuvres (hors catalogue raisonné) : atelier, exposition, collectionneur, combinaison, détail.';
comment on column public.work_photos.file_path is 'Chemin relatif au site (media/photos/…)';

create table public.work_photo_links (
  photo_id uuid not null references public.work_photos (id) on delete cascade,
  work_id text not null references public.works (id) on update cascade on delete cascade,
  primary key (photo_id, work_id)
);

create index work_photo_links_work_idx on public.work_photo_links (work_id);

alter table public.work_photo_types enable row level security;
alter table public.work_photos enable row level security;
alter table public.work_photo_links enable row level security;

create policy "work_photo_types_public_read"
  on public.work_photo_types for select to anon, authenticated using (true);
create policy "work_photos_public_read"
  on public.work_photos for select to anon, authenticated using (true);
create policy "work_photo_links_public_read"
  on public.work_photo_links for select to anon, authenticated using (true);

-- Format diptyque
update public.formats set code = 'DIPT', label = 'Diptyque (préciser)' where code = 'DYPT';
