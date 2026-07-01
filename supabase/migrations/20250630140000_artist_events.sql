-- Parcours artistique : événements (expositions, collections, organisation)

create table public.event_types (
  code text primary key check (code ~ '^[A-Z0-9_]{2,20}$'),
  label text not null default '',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.event_roles (
  code text primary key check (code ~ '^[A-Z0-9_]{2,20}$'),
  label text not null default '',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.artist_events (
  id uuid primary key default gen_random_uuid(),
  event_type_code text not null references public.event_types (code),
  role_code text not null references public.event_roles (code),
  date_label text not null default '',
  sort_date date not null,
  sort_date_end date,
  label text not null default '',
  note text not null default '',
  publication_status_code text not null default 'N' references public.publication_statuses (code),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (sort_date_end is null or sort_date_end >= sort_date)
);

create table public.artist_event_media (
  event_id uuid not null references public.artist_events (id) on delete cascade,
  media_id uuid not null references public.related_media (id) on delete cascade,
  primary key (event_id, media_id)
);

create index artist_events_type_idx on public.artist_events (event_type_code);
create index artist_events_sort_date_idx on public.artist_events (sort_date desc);
create index artist_events_publication_idx on public.artist_events (publication_status_code);
create index artist_event_media_media_id_idx on public.artist_event_media (media_id);

create trigger event_types_set_updated_at
  before update on public.event_types
  for each row execute function public.set_updated_at();

create trigger event_roles_set_updated_at
  before update on public.event_roles
  for each row execute function public.set_updated_at();

create trigger artist_events_set_updated_at
  before update on public.artist_events
  for each row execute function public.set_updated_at();

alter table public.event_types enable row level security;
alter table public.event_roles enable row level security;
alter table public.artist_events enable row level security;
alter table public.artist_event_media enable row level security;

create policy "event_types_public_read"
  on public.event_types for select to anon, authenticated using (true);

create policy "event_roles_public_read"
  on public.event_roles for select to anon, authenticated using (true);

create policy "artist_events_public_read"
  on public.artist_events for select to anon, authenticated using (true);

create policy "artist_event_media_public_read"
  on public.artist_event_media for select to anon, authenticated using (true);

insert into public.event_types (code, label, sort_order) values
  ('SOLO', 'Expositions personnelles', 10),
  ('COLLECTIVE', 'Expositions collectives', 20),
  ('COLLECTION', 'Collections publiques', 30),
  ('ORG', 'Organisation d''expositions', 40)
on conflict (code) do update set
  label = excluded.label,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.event_roles (code, label, sort_order) values
  ('ARTIST', 'Artiste', 10),
  ('ORGANIZER', 'Organisatrice', 20)
on conflict (code) do update set
  label = excluded.label,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.artist_events (
  id,
  event_type_code,
  role_code,
  date_label,
  sort_date,
  sort_date_end,
  label,
  note,
  publication_status_code,
  sort_order
) values
  ('e1000001-0000-4000-8000-000000000001', 'SOLO', 'ARTIST', '2017', '2017-01-01', null, 'Galerie La Capitale, Paris — « La fin des temps »', '', 'W', 10),
  ('e1000002-0000-4000-8000-000000000001', 'SOLO', 'ARTIST', '2014', '2014-01-01', null, 'Marais Chrétien, Église Saint-Denys, Paris 3ᵉ', '', 'W', 20),
  ('e1000003-0000-4000-8000-000000000001', 'SOLO', 'ARTIST', '2010', '2010-01-01', null, 'Mairie du 3ᵉ — « L''enfer et le Paradis », Marais chrétien', '', 'W', 30),
  ('e1000004-0000-4000-8000-000000000001', 'SOLO', 'ARTIST', '2006', '2006-01-01', null, 'Hôtel de Sauroy, Paris', '', 'W', 40),
  ('e1000005-0000-4000-8000-000000000001', 'SOLO', 'ARTIST', '2004', '2004-01-01', null, 'Hôtel des Chartreux, Paris', '', 'W', 50),
  ('e1000006-0000-4000-8000-000000000001', 'SOLO', 'ARTIST', '2004', '2004-01-01', null, 'Galerie Peinture Fraîche, Paris', '', 'W', 60),
  ('e1000007-0000-4000-8000-000000000001', 'SOLO', 'ARTIST', '2001', '2001-01-01', null, 'Association Philomuses, Paris', '', 'W', 70),
  ('e1000008-0000-4000-8000-000000000001', 'SOLO', 'ARTIST', '1999', '1999-01-01', null, 'Maison de la Grèce, Paris', '', 'W', 80),
  ('e1000009-0000-4000-8000-000000000001', 'SOLO', 'ARTIST', '1997', '1997-01-01', null, 'Galerie Nicole Ferry, Paris', '', 'W', 90),
  ('e1000010-0000-4000-8000-000000000001', 'SOLO', 'ARTIST', '1995', '1995-01-01', null, 'Galerie Nicole Ferry, Paris', '', 'W', 100),
  ('e1000011-0000-4000-8000-000000000001', 'SOLO', 'ARTIST', '1994', '1994-01-01', null, 'Galerie Image, Athènes', '', 'W', 110),
  ('e1000012-0000-4000-8000-000000000001', 'SOLO', 'ARTIST', '1994', '1994-01-01', null, 'Maison de Chypre, Athènes', '', 'W', 120),
  ('e1000013-0000-4000-8000-000000000001', 'SOLO', 'ARTIST', '1994', '1994-01-01', null, 'Galerie Nicole Ferry, Paris', '', 'W', 130),
  ('e1000014-0000-4000-8000-000000000001', 'SOLO', 'ARTIST', '1992', '1992-01-01', null, 'Galerie Nicole Ferry, Paris', '', 'W', 140),
  ('e1000015-0000-4000-8000-000000000001', 'SOLO', 'ARTIST', '1990', '1990-01-01', null, 'Galerie du Haut Pavé, Paris', '', 'W', 150),
  ('e1000016-0000-4000-8000-000000000001', 'SOLO', 'ARTIST', '1990', '1990-01-01', null, 'Galerie Nicole Ferry, Paris', '', 'W', 160),
  ('e1000017-0000-4000-8000-000000000001', 'SOLO', 'ARTIST', '1989', '1989-01-01', null, 'Abbaye de Mondaye, Calvados', '', 'W', 170),
  ('e1000018-0000-4000-8000-000000000001', 'SOLO', 'ARTIST', '1988', '1988-01-01', null, 'Galerie Nicole Ferry, Paris', '', 'W', 180),
  ('e1000019-0000-4000-8000-000000000001', 'COLLECTIVE', 'ARTIST', '2016', '2016-01-01', null, 'Galerie Peinture Fraîche — trois peintres de Face à l''Art', '', 'W', 10),
  ('e1000020-0000-4000-8000-000000000001', 'COLLECTIVE', 'ARTIST', '2016', '2016-01-01', null, 'Fort Rammekens, Pays-Bas — « Treize peintres »', '', 'W', 20),
  ('e1000021-0000-4000-8000-000000000001', 'COLLECTIVE', 'ARTIST', '2016', '2016-01-01', null, 'Villa des Arts, Paris — « Trois peintres »', '', 'W', 30),
  ('e1000022-0000-4000-8000-000000000001', 'COLLECTIVE', 'ARTIST', '2016', '2016-01-01', null, 'Château d''eau, Bourges — « Treize peintres »', '', 'W', 40),
  ('e1000023-0000-4000-8000-000000000001', 'COLLECTIVE', 'ARTIST', '2009', '2009-01-01', null, 'FID (Foire internationale du dessin du XXIᵉ siècle), Paris', '', 'W', 50),
  ('e1000024-0000-4000-8000-000000000001', 'COLLECTIVE', 'ARTIST', '2009', '2009-01-01', null, 'Musée Rignault, Saint-Cirq-Lapopie (Lot)', '', 'W', 60),
  ('e1000025-0000-4000-8000-000000000001', 'COLLECTIVE', 'ARTIST', '2008', '2008-01-01', null, 'Galerie Nicole Ferry, Paris', '', 'W', 70),
  ('e1000026-0000-4000-8000-000000000001', 'COLLECTIVE', 'ARTIST', '2007', '2007-01-01', null, 'Galerie Nicole Ferry, Paris — « Les vingt ans »', '', 'W', 80),
  ('e1000027-0000-4000-8000-000000000001', 'COLLECTIVE', 'ARTIST', '2007', '2007-01-01', null, 'Carte blanche à Anne Malherbe, Galerie Defrost, Paris', '', 'W', 90),
  ('e1000028-0000-4000-8000-000000000001', 'COLLECTIVE', 'ARTIST', '2007', '2007-01-01', null, 'Galerie Nicole Ferry, Paris — « Rouge »', '', 'W', 100),
  ('e1000029-0000-4000-8000-000000000001', 'COLLECTIVE', 'ARTIST', '2005', '2005-01-01', null, '« Noir & Blanc », Musée Saint-Germain, Auxerre', '', 'W', 110),
  ('e1000030-0000-4000-8000-000000000001', 'COLLECTIVE', 'ARTIST', '2005', '2005-01-01', null, '« Les messagers de l''invisible », Musée Saint-Germain, Auxerre', '', 'W', 120),
  ('e1000031-0000-4000-8000-000000000001', 'COLLECTIVE', 'ARTIST', '2002', '2002-01-01', null, '« Tête », Europ''Art, Genève', '', 'W', 130),
  ('e1000032-0000-4000-8000-000000000001', 'COLLECTIVE', 'ARTIST', '2002', '2002-01-01', null, '« Tête », Espace Beaurepaire, Paris', '', 'W', 140),
  ('e1000033-0000-4000-8000-000000000001', 'COLLECTIVE', 'ARTIST', '1997', '1997-01-01', null, '4ᵉ Salon international des arts plastiques, Valognes', '', 'W', 150),
  ('e1000034-0000-4000-8000-000000000001', 'COLLECTIVE', 'ARTIST', '1995', '1995-01-01', null, 'Galerie Area, Paris', '', 'W', 160),
  ('e1000035-0000-4000-8000-000000000001', 'COLLECTIVE', 'ARTIST', '1994', '1994-01-01', null, 'Salon des Réalités nouvelles, Paris', '', 'W', 170),
  ('e1000036-0000-4000-8000-000000000001', 'COLLECTIVE', 'ARTIST', '1993', '1993-01-01', null, 'Musée de Toulon — Donation Alin Avila', '', 'W', 180),
  ('e1000037-0000-4000-8000-000000000001', 'COLLECTIVE', 'ARTIST', '1993', '1993-01-01', null, 'Saga Galerie Area — édition Alin Avila : « Le bain d''Aphrodite »', '', 'W', 190),
  ('e1000038-0000-4000-8000-000000000001', 'COLLECTIVE', 'ARTIST', '1991', '1991-01-01', null, 'Salon Découvertes, Grand Palais, Paris', '', 'W', 200),
  ('e1000039-0000-4000-8000-000000000001', 'COLLECTIVE', 'ARTIST', '1991', '1991-01-01', null, 'Reg''Art, Belfort', '', 'W', 210),
  ('e1000040-0000-4000-8000-000000000001', 'COLLECTIVE', 'ARTIST', '1991', '1991-01-01', null, 'Salon de Montrouge (peinture)', '', 'W', 220),
  ('e1000041-0000-4000-8000-000000000001', 'COLLECTIVE', 'ARTIST', '1990', '1990-01-01', null, 'Triennale d''Osaka, Japon', '', 'W', 230),
  ('e1000042-0000-4000-8000-000000000001', 'COLLECTIVE', 'ARTIST', '1988–1989', '1988-01-01', '1989-12-31', 'Salon Jeune Peinture', '', 'W', 240),
  ('e1000043-0000-4000-8000-000000000001', 'COLLECTIVE', 'ARTIST', '1988–1999', '1988-01-01', '1999-12-31', 'Régulièrement à la Galerie Nicole Ferry', '', 'W', 250),
  ('e1000044-0000-4000-8000-000000000001', 'COLLECTIVE', 'ARTIST', '1987', '1987-01-01', null, 'Galerie Beau Lézard, Paris', '', 'W', 260),
  ('e1000045-0000-4000-8000-000000000001', 'COLLECTIVE', 'ARTIST', '1986', '1986-01-01', null, 'Salon de Montrouge (peinture)', '', 'W', 270),
  ('e1000046-0000-4000-8000-000000000001', 'COLLECTIVE', 'ARTIST', '1984', '1984-01-01', null, 'Salon de Montrouge (peinture)', '', 'W', 280),
  ('e1000047-0000-4000-8000-000000000001', 'COLLECTIVE', 'ARTIST', '1984', '1984-01-01', null, 'XVIᵉ Festival international de peinture, Musée de Cagnes-sur-Mer (sélection Brigitte Hedelsamson)', '', 'W', 290),
  ('e1000048-0000-4000-8000-000000000001', 'COLLECTIVE', 'ARTIST', '1982', '1982-01-01', null, 'Galerie Peinture Fraîche, Paris', '', 'W', 300),
  ('e1000049-0000-4000-8000-000000000001', 'COLLECTIVE', 'ARTIST', '1979', '1979-01-01', null, 'Maison des Beaux-Arts, Paris — « 4 élèves de Jean Bertholle »', '', 'W', 310),
  ('e1000050-0000-4000-8000-000000000001', 'COLLECTION', 'ARTIST', '1993', '1993-01-01', null, 'Musée de Toulon — Donation Alin Avila', '', 'W', 10),
  ('e1000051-0000-4000-8000-000000000001', 'COLLECTION', 'ARTIST', '1986', '1986-01-01', null, 'Ville de Paris', '', 'W', 20),
  ('e1000052-0000-4000-8000-000000000001', 'COLLECTION', 'ARTIST', '1985', '1985-01-01', null, 'Fondation Art et Dialogue', '', 'W', 30),
  ('e1000053-0000-4000-8000-000000000001', 'COLLECTION', 'ARTIST', '1983', '1983-01-01', null, 'Fonds national d''art contemporain', '', 'W', 40),
  ('e1000054-0000-4000-8000-000000000001', 'ORG', 'ORGANIZER', '2005', '2005-01-01', null, '« Noir et Blanc », Musée-abbaye Saint-Germain — parrainage de Micheline Durand, conservateur des musées d''Auxerre', '', 'W', 10),
  ('e1000055-0000-4000-8000-000000000001', 'ORG', 'ORGANIZER', '2003', '2003-01-01', null, '« Animal et Territoire », Orangerie du Sénat, ARSENAT', '', 'W', 20),
  ('e1000056-0000-4000-8000-000000000001', 'ORG', 'ORGANIZER', '2002', '2002-01-01', null, '« Tête » — Vingt-cinq peintres de Face à l''Art, Europ''Art, Genève', '', 'W', 30),
  ('e1000057-0000-4000-8000-000000000001', 'ORG', 'ORGANIZER', '2002', '2002-01-01', null, '« Tête », Espace Beaurepaire, Paris', '', 'W', 40)
on conflict (id) do update set
  event_type_code = excluded.event_type_code,
  role_code = excluded.role_code,
  date_label = excluded.date_label,
  sort_date = excluded.sort_date,
  sort_date_end = excluded.sort_date_end,
  label = excluded.label,
  note = excluded.note,
  publication_status_code = excluded.publication_status_code,
  sort_order = excluded.sort_order,
  updated_at = now();
