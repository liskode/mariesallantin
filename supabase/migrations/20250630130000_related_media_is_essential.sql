-- Favoris page Ressources (filtre « Essentiels »)

alter table public.related_media
  add column if not exists is_essential boolean not null default false;

comment on column public.related_media.is_essential is 'Ressource mise en avant dans le filtre Essentiels du site public';
