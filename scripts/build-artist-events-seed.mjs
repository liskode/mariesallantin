#!/usr/bin/env node
/**
 * Génère le seed SQL et events-data.js à partir des données CV source.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const sections = [
  {
    type: 'P',
    entries: [
      { year: '2017', label: 'Galerie La Capitale, Paris — « La fin des temps »' },
      { year: '2014', label: 'Marais Chrétien, Église Saint-Denys, Paris 3ᵉ' },
      { year: '2010', label: "Mairie du 3ᵉ — « L'enfer et le Paradis », Marais chrétien" },
      { year: '2006', label: 'Hôtel de Sauroy, Paris' },
      { year: '2004', label: 'Hôtel des Chartreux, Paris' },
      { year: '2004', label: 'Galerie Peinture Fraîche, Paris' },
      { year: '2001', label: 'Association Philomuses, Paris' },
      { year: '1999', label: 'Maison de la Grèce, Paris' },
      { year: '1997', label: 'Galerie Nicole Ferry, Paris' },
      { year: '1995', label: 'Galerie Nicole Ferry, Paris' },
      { year: '1994', label: 'Galerie Image, Athènes' },
      { year: '1994', label: 'Maison de Chypre, Athènes' },
      { year: '1994', label: 'Galerie Nicole Ferry, Paris' },
      { year: '1992', label: 'Galerie Nicole Ferry, Paris' },
      { year: '1990', label: 'Galerie du Haut Pavé, Paris' },
      { year: '1990', label: 'Galerie Nicole Ferry, Paris' },
      { year: '1989', label: 'Abbaye de Mondaye, Calvados' },
      { year: '1988', label: 'Galerie Nicole Ferry, Paris' },
    ],
  },
  {
    type: 'C',
    entries: [
      { year: '2016', label: "Galerie Peinture Fraîche — trois peintres de Face à l'Art" },
      { year: '2016', label: 'Fort Rammekens, Pays-Bas — « Treize peintres »' },
      { year: '2016', label: 'Villa des Arts, Paris — « Trois peintres »' },
      { year: '2016', label: "Château d'eau, Bourges — « Treize peintres »" },
      { year: '2009', label: 'FID (Foire internationale du dessin du XXIᵉ siècle), Paris' },
      { year: '2009', label: 'Musée Rignault, Saint-Cirq-Lapopie (Lot)' },
      { year: '2008', label: 'Galerie Nicole Ferry, Paris' },
      { year: '2007', label: 'Galerie Nicole Ferry, Paris — « Les vingt ans »' },
      { year: '2007', label: 'Carte blanche à Anne Malherbe, Galerie Defrost, Paris' },
      { year: '2007', label: 'Galerie Nicole Ferry, Paris — « Rouge »' },
      { year: '2005', label: '« Noir & Blanc », Musée Saint-Germain, Auxerre' },
      { year: '2005', label: "« Les messagers de l'invisible », Musée Saint-Germain, Auxerre" },
      { year: '2002', label: "« Tête », Europ'Art, Genève" },
      { year: '2002', label: '« Tête », Espace Beaurepaire, Paris' },
      { year: '1997', label: '4ᵉ Salon international des arts plastiques, Valognes' },
      { year: '1995', label: 'Galerie Area, Paris' },
      { year: '1994', label: 'Salon des Réalités nouvelles, Paris' },
      { year: '1993', label: 'Musée de Toulon — Donation Alin Avila' },
      { year: '1993', label: "Saga Galerie Area — édition Alin Avila : « Le bain d'Aphrodite »" },
      { year: '1991', label: 'Salon Découvertes, Grand Palais, Paris' },
      { year: '1991', label: "Reg'Art, Belfort" },
      { year: '1991', label: 'Salon de Montrouge (peinture)' },
      { year: '1990', label: "Triennale d'Osaka, Japon" },
      { year: '1988–1989', label: 'Salon Jeune Peinture' },
      { year: '1988–1999', label: 'Régulièrement à la Galerie Nicole Ferry' },
      { year: '1987', label: 'Galerie Beau Lézard, Paris' },
      { year: '1986', label: 'Salon de Montrouge (peinture)' },
      { year: '1984', label: 'Salon de Montrouge (peinture)' },
      {
        year: '1984',
        label:
          'XVIᵉ Festival international de peinture, Musée de Cagnes-sur-Mer (sélection Brigitte Hedelsamson)',
      },
      { year: '1982', label: 'Galerie Peinture Fraîche, Paris' },
      { year: '1979', label: 'Maison des Beaux-Arts, Paris — « 4 élèves de Jean Bertholle »' },
    ],
  },
  {
    type: 'Q',
    entries: [
      { year: '1993', label: 'Musée de Toulon — Donation Alin Avila' },
      { year: '1986', label: 'Ville de Paris' },
      { year: '1985', label: 'Fondation Art et Dialogue' },
      { year: '1983', label: "Fonds national d'art contemporain" },
    ],
  },
  {
    type: 'O',
    entries: [
      {
        year: '2005',
        label:
          "« Noir et Blanc », Musée-abbaye Saint-Germain — parrainage de Micheline Durand, conservateur des musées d'Auxerre",
      },
      { year: '2003', label: '« Animal et Territoire », Orangerie du Sénat, ARSENAT' },
      { year: '2002', label: "« Tête » — Vingt-cinq peintres de Face à l'Art, Europ'Art, Genève" },
      { year: '2002', label: '« Tête », Espace Beaurepaire, Paris' },
    ],
  },
];

function sqlStr(v) {
  if (v == null || v === '') return "''";
  return "'" + String(v).replace(/'/g, "''") + "'";
}

const eventTypes = [
  { code: 'P', label: 'Expositions personnelles', sort_order: 10 },
  { code: 'C', label: 'Expositions collectives', sort_order: 20 },
  { code: 'Q', label: 'Collections publiques', sort_order: 30 },
  { code: 'O', label: "Organisation d'expositions", sort_order: 40 },
];

const items = [];
let n = 0;
for (const section of sections) {
  let order = 10;
  for (const entry of section.entries) {
    n++;
    items.push({
      id: `e100${String(n).padStart(4, '0')}-0000-4000-8000-000000000001`,
      event_type_code: section.type,
      date_label: String(entry.year).trim().replace(/-/g, '–'),
      label: entry.label,
      note: '',
      publication_status_code: 'W',
      sort_order: order,
      media_ids: [],
    });
    order += 10;
  }
}

const insertTypes = eventTypes
  .map(
    (t) =>
      `  (${sqlStr(t.code)}, ${sqlStr(t.label)}, ${t.sort_order})`
  )
  .join(',\n');

const insertEvents = items
  .map(
    (e) =>
      `  (${sqlStr(e.id)}, ${sqlStr(e.event_type_code)}, ${sqlStr(e.date_label)}, ${sqlStr(e.label)}, ${sqlStr(e.note)}, ${sqlStr(e.publication_status_code)}, ${e.sort_order})`
  )
  .join(',\n');

const migration = `-- Parcours artistique : événements (expositions, collections, organisation)

create table public.event_types (
  code text primary key check (code ~ '^[A-Z0-9_]{1,4}$'),
  label text not null default '',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.artist_events (
  id uuid primary key default gen_random_uuid(),
  event_type_code text not null references public.event_types (code),
  date_label text not null default '',
  label text not null default '',
  note text not null default '',
  publication_status_code text not null default 'N' references public.publication_statuses (code),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.artist_event_media (
  event_id uuid not null references public.artist_events (id) on delete cascade,
  media_id uuid not null references public.related_media (id) on delete cascade,
  primary key (event_id, media_id)
);

create index artist_events_type_idx on public.artist_events (event_type_code);
create index artist_events_publication_idx on public.artist_events (publication_status_code);
create index artist_event_media_media_id_idx on public.artist_event_media (media_id);

create trigger event_types_set_updated_at
  before update on public.event_types
  for each row execute function public.set_updated_at();

create trigger artist_events_set_updated_at
  before update on public.artist_events
  for each row execute function public.set_updated_at();

alter table public.event_types enable row level security;
alter table public.artist_events enable row level security;
alter table public.artist_event_media enable row level security;

create policy "event_types_public_read"
  on public.event_types for select to anon, authenticated using (true);

create policy "artist_events_public_read"
  on public.artist_events for select to anon, authenticated using (true);

create policy "artist_event_media_public_read"
  on public.artist_event_media for select to anon, authenticated using (true);

insert into public.event_types (code, label, sort_order) values
${insertTypes}
on conflict (code) do update set
  label = excluded.label,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.artist_events (
  id,
  event_type_code,
  date_label,
  label,
  note,
  publication_status_code,
  sort_order
) values
${insertEvents}
on conflict (id) do update set
  event_type_code = excluded.event_type_code,
  date_label = excluded.date_label,
  label = excluded.label,
  note = excluded.note,
  publication_status_code = excluded.publication_status_code,
  sort_order = excluded.sort_order,
  updated_at = now();
`;

fs.writeFileSync(
  path.join(root, 'supabase/migrations/20250630140000_artist_events.sql'),
  migration
);

const jsData = `/**
 * Repli éditorial — événements parcours artistique (aligné sur artist_events Supabase).
 */
(function (global) {
  global.EventsData = ${JSON.stringify({ event_types: eventTypes, items }, null, 2)};
})(typeof window !== 'undefined' ? window : globalThis);
`;

fs.writeFileSync(path.join(root, 'site-v2/events-data.js'), jsData);
console.error('Wrote migration (' + items.length + ' events) and site-v2/events-data.js');
