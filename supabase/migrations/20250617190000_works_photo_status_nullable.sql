-- Statut photo optionnel à l'import (pas de valeur par défaut imposée).
alter table public.works alter column photo_status_code drop default;
alter table public.works alter column photo_status_code drop not null;

comment on column public.works.photo_status_code is
  'Code statut photo (FK photo_statuses). Null si non renseigné à l''import.';
