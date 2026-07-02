-- Ressources site public : champs fichier/vignette + types courts + seed initial

insert into public.media_types (code, label, sort_order) values
  ('W', 'Lien web', 5)
on conflict (code) do update set
  label = excluded.label,
  sort_order = excluded.sort_order,
  updated_at = now();

alter table public.related_media
  add column if not exists thumbnail_path text not null default '',
  add column if not exists file_path text not null default '',
  add column if not exists internal_path text not null default '',
  add column if not exists duration_seconds int check (duration_seconds is null or duration_seconds > 0);

comment on column public.related_media.thumbnail_path is 'Chemin relatif site (images/…, media/ressources/…) ou URL absolue';
comment on column public.related_media.file_path is 'PDF, scan presse, audio/vidéo hébergé sous media/ressources/';
comment on column public.related_media.internal_path is 'Page interne site-v2 (ex. fap.html)';

insert into public.related_media (
  id,
  media_type_code,
  title,
  media_date,
  source,
  description,
  url,
  thumbnail_path,
  file_path,
  internal_path,
  publication_status_code,
  sort_order
) values
  (
    'c1000001-0000-4000-8000-000000000001',
    'P',
    'Marie Sallantin met la pression',
    null,
    'Sur la peinture',
    '',
    'http://sur-la-peinture.com/marie-sallantin-met-la-pression/#more-6342',
    '',
    '',
    '',
    'W',
    10
  ),
  (
    'c1000002-0000-4000-8000-000000000002',
    'W',
    'Exposition à La Capitale Galerie',
    null,
    'La Capitale Galerie',
    '',
    'https://lacapitalegalerie.fr/marie-sallantin-2',
    '',
    '',
    '',
    'W',
    20
  ),
  (
    'c1000003-0000-4000-8000-000000000003',
    'W',
    'Galerie Peinture Fraîche',
    null,
    'Galerie Peinture Fraîche',
    '',
    'https://galeriepeinturefraiche.art/sallantin-marie',
    '',
    '',
    '',
    'W',
    30
  ),
  (
    'c1000004-0000-4000-8000-000000000004',
    'V',
    'Interview avec David Foenkinos',
    null,
    'KTOTV',
    '',
    'https://www.ktotv.com/video/00071872/david-foenkinos-et-marie-sallantin',
    '',
    '',
    '',
    'W',
    40
  ),
  (
    'c1000005-0000-4000-8000-000000000005',
    'W',
    'Face à l''Art — salon virtuel de peintres',
    null,
    'Face à l''Art',
    '',
    '',
    'images/logo-fap.jpg',
    '',
    'fap.html',
    'W',
    50
  )
on conflict (id) do update set
  media_type_code = excluded.media_type_code,
  title = excluded.title,
  media_date = excluded.media_date,
  source = excluded.source,
  description = excluded.description,
  url = excluded.url,
  thumbnail_path = excluded.thumbnail_path,
  file_path = excluded.file_path,
  internal_path = excluded.internal_path,
  publication_status_code = excluded.publication_status_code,
  sort_order = excluded.sort_order,
  updated_at = now();
