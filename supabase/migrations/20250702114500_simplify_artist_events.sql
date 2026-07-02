-- Simplifie artist_events : type court sur 1 caractère, sans role_code,
-- sans sort_date / sort_date_end. Le tri public repose sur sort_order.

alter table public.event_types
  drop constraint if exists event_types_code_check;

insert into public.event_types (code, label, sort_order) values
  ('P', 'Expositions personnelles', 10),
  ('C', 'Expositions collectives', 20),
  ('Q', 'Collections publiques', 30),
  ('O', 'Organisation d''expositions', 40)
on conflict (code) do update set
  label = excluded.label,
  sort_order = excluded.sort_order,
  updated_at = now();

update public.artist_events
set event_type_code = case event_type_code
  when 'SOLO' then 'P'
  when 'COLLECTIVE' then 'C'
  when 'COLLECTION' then 'Q'
  when 'ORG' then 'O'
  else event_type_code
end
where event_type_code in ('SOLO', 'COLLECTIVE', 'COLLECTION', 'ORG');

delete from public.event_types
where code in ('SOLO', 'COLLECTIVE', 'COLLECTION', 'ORG');

alter table public.event_types
  add constraint event_types_code_check
  check (code ~ '^[A-Z0-9_]{1,4}$');

drop index if exists artist_events_sort_date_idx;

alter table public.artist_events
  drop column if exists role_code,
  drop column if exists sort_date,
  drop column if exists sort_date_end;

drop table if exists public.event_roles cascade;
