-- Crédit photographique libre (texte) sur chaque œuvre.
alter table public.works
  add column if not exists photo_credit text not null default '';

comment on column public.works.photo_credit is
  'Crédit photographique libre (ex. nom du photographe). Vide si non renseigné.';
