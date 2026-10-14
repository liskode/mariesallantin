-- Tri en ligne d'un export de photothèque (page tri-photos.html) :
-- images de travail dans un espace de stockage public, cartes et décisions en base (éditeurs uniquement).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tri-photos', 'tri-photos', true, 5242880, array['image/jpeg'])
on conflict (id) do nothing;

create table if not exists public.photo_triage_exports (
  id text primary key,
  label text not null default '',
  triage jsonb not null,
  image_base text not null default '',
  updated_at timestamptz not null default now()
);

comment on table public.photo_triage_exports is
  'Exports de photothèque à trier : cartes (groupes de photos d''une même toile) produites par export-triage-build.mjs.';

create table if not exists public.photo_triage_decisions (
  export_id text not null references public.photo_triage_exports (id) on delete cascade,
  group_id text not null,
  decision jsonb not null default '{}'::jsonb,
  photos text[] not null default '{}',
  result jsonb,
  updated_at timestamptz not null default now(),
  primary key (export_id, group_id)
);

comment on column public.photo_triage_decisions.photos is
  'Noms des photos de la carte au moment de la décision (pour la retrouver si les numéros de carte changent).';
comment on column public.photo_triage_decisions.result is
  'Rempli par l''import local : œuvre créée, photo remplacée, autre photo ajoutée.';

-- Pas de lecture publique : accès via l'Edge Function triage-api (mot de passe éditeur).
alter table public.photo_triage_exports enable row level security;
alter table public.photo_triage_decisions enable row level security;
