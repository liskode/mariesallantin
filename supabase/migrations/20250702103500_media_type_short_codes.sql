-- Raccourcit les codes media_types en 1 lettre.
-- W=web, P=presse, X=expo/entretien expo, C=catalogue/livre, V=vidéo, A=audio

alter table public.media_types
  drop constraint if exists media_types_code_check;

alter table public.media_types
  add constraint media_types_code_check
  check (code ~ '^[A-Z0-9]{1,12}$');

update public.media_types
set code = 'W', label = 'Lien web', sort_order = 5
where code = 'WEB';

update public.media_types
set code = 'P', label = 'Article de presse', sort_order = 10
where code = 'PRESS';

update public.media_types
set code = 'X', label = 'Exposition / entretien d''exposition', sort_order = 20
where code = 'EXCAT';

update public.media_types
set code = 'C', label = 'Catalogue / livre', sort_order = 30
where code = 'BOOK';

update public.media_types
set code = 'V', label = 'Vidéo', sort_order = 40
where code = 'VIDEO';

update public.media_types
set code = 'A', label = 'Enregistrement audio', sort_order = 50
where code = 'AUDIO';

insert into public.media_types (code, label, sort_order) values
  ('W', 'Lien web', 5),
  ('P', 'Article de presse', 10),
  ('X', 'Exposition / entretien d''exposition', 20),
  ('C', 'Catalogue / livre', 30),
  ('V', 'Vidéo', 40),
  ('A', 'Enregistrement audio', 50)
on conflict (code) do update set
  label = excluded.label,
  sort_order = excluded.sort_order,
  updated_at = now();

update public.related_media
set media_type_code = case media_type_code
  when 'WEB' then 'W'
  when 'PRESS' then 'P'
  when 'EXCAT' then 'X'
  when 'BOOK' then 'C'
  when 'VIDEO' then 'V'
  when 'AUDIO' then 'A'
  else media_type_code
end
where media_type_code in ('WEB', 'PRESS', 'EXCAT', 'BOOK', 'VIDEO', 'AUDIO');
