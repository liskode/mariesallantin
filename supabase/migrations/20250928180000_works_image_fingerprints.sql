-- Empreintes image pour détection de doublons (hash exact + perceptuel).
alter table public.works
  add column if not exists file_sha256 text,
  add column if not exists phash text;

comment on column public.works.file_sha256 is
  'SHA-256 hex du fichier catalogue (octets identiques = doublon certain).';

comment on column public.works.phash is
  'Difference hash 64 bits (hex) pour similarité visuelle (cadrage / colorimétrie proches).';

create index if not exists works_file_sha256_idx
  on public.works (file_sha256)
  where file_sha256 is not null;

create index if not exists works_phash_idx
  on public.works (phash)
  where phash is not null;
