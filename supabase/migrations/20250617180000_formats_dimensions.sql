-- Dimensions physiques des formats de tableau (cm).

alter table public.formats
  add column if not exists width_cm numeric(8, 2);

alter table public.formats
  add column if not exists height_cm numeric(8, 2);

alter table public.formats
  drop constraint if exists formats_width_cm_check;

alter table public.formats
  add constraint formats_width_cm_check
  check (width_cm is null or width_cm > 0);

alter table public.formats
  drop constraint if exists formats_height_cm_check;

alter table public.formats
  add constraint formats_height_cm_check
  check (height_cm is null or height_cm > 0);

comment on column public.formats.width_cm is 'Largeur du format en centimètres.';
comment on column public.formats.height_cm is 'Hauteur du format en centimètres.';
