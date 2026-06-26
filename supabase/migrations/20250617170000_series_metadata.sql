-- Métadonnées éditoriales des séries : icône (œuvre MS####), années, description.
-- Idempotent.

alter table public.series
  add column if not exists icon_work_id text references public.works (id)
    on update cascade on delete set null;

alter table public.series
  add column if not exists year_start smallint;

alter table public.series
  add column if not exists year_end smallint;

alter table public.series
  add column if not exists description text not null default '';

alter table public.series
  drop constraint if exists series_year_start_check;

alter table public.series
  add constraint series_year_start_check
  check (year_start is null or (year_start >= 1000 and year_start <= 9999));

alter table public.series
  drop constraint if exists series_year_end_check;

alter table public.series
  add constraint series_year_end_check
  check (year_end is null or (year_end >= 1000 and year_end <= 9999));

alter table public.series
  drop constraint if exists series_years_order_check;

alter table public.series
  add constraint series_years_order_check
  check (
    year_start is null
    or year_end is null
    or year_end >= year_start
  );

create index if not exists series_icon_work_id_idx on public.series (icon_work_id);

comment on column public.series.icon_work_id is
  'Œuvre illustrant la série (ex. MS0024). Vignette dans le menu / fiche série.';
comment on column public.series.year_start is
  'Année de début du travail sur la série (optionnel).';
comment on column public.series.year_end is
  'Année de fin du travail sur la série (optionnel).';
comment on column public.series.description is
  'Texte de présentation (un ou plusieurs paragraphes).';
