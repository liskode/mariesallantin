-- Migration : table works uniquement (idempotent).
-- - Supprime width_px, height_px (dimensions lues depuis le fichier image)
-- - Conserve file_size_bytes, image_ext
-- - Ajoute filename_original (traçabilité de l'ancien nom de fichier)

alter table public.works
  drop column if exists width_px;

alter table public.works
  drop column if exists height_px;

alter table public.works
  add column if not exists filename_original text;

comment on column public.works.image_ext is
  'Extension du fichier image. URL : {id}.{image_ext} (ex. MS0001.jpeg).';

comment on column public.works.file_size_bytes is
  'Taille du fichier en octets ; indicateur rapide de qualité sans ouvrir l''image.';

comment on column public.works.filename_original is
  'Ancien nom de fichier complet, à titre historique ; non utilisé pour la navigation.';
