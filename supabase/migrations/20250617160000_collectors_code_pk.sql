-- Collectionneurs : clé stable `code` (COL####), `name` éditable (unique).
-- Remplace la PK `name` et works.collector_name → works.collector_code.
-- Idempotent : relançable sur un projet partiellement migré.

-- 1. Colonne code sur collectors
alter table public.collectors
  add column if not exists code text;

-- Attribuer COL0001, COL0002… aux lignes sans code (ordre alphabétique du nom)
with numbered as (
  select
    name,
    'COL' || lpad(row_number() over (order by name)::text, 4, '0') as new_code
  from public.collectors
  where code is null or trim(code) = ''
)
update public.collectors c
set code = n.new_code
from numbered n
where c.name = n.name
  and (c.code is null or trim(c.code) = '');

alter table public.collectors
  alter column code set not null;

-- 2. FK œuvres → code
alter table public.works
  add column if not exists collector_code text;

update public.works w
set collector_code = c.code
from public.collectors c
where w.collector_name is not null
  and w.collector_name = c.name
  and (w.collector_code is null or w.collector_code = '');

alter table public.works
  drop constraint if exists works_collector_name_fkey;

alter table public.works
  drop column if exists collector_name;

-- 3. PK collectors : name → code
alter table public.collectors
  drop constraint if exists collectors_pkey;

alter table public.collectors
  add constraint collectors_pkey primary key (code);

alter table public.collectors
  drop constraint if exists collectors_name_key;

alter table public.collectors
  add constraint collectors_name_key unique (name);

alter table public.works
  drop constraint if exists works_collector_code_fkey;

alter table public.works
  add constraint works_collector_code_fkey
  foreign key (collector_code) references public.collectors (code)
  on update cascade on delete set null;

create index if not exists works_collector_code_idx on public.works (collector_code);

comment on column public.collectors.code is
  'Identifiant stable (COL####). Ne pas modifier après création.';
comment on column public.collectors.name is
  'Nom affiché / éditable. Unique.';
comment on column public.works.collector_code is
  'Référence collectionneur (FK collectors.code).';
