-- Statut G (Gallery) : publié sur le site (comme W) + galerie d'accueil.
-- Idempotent.

insert into public.publication_statuses (code, label, sort_order) values
  ('G', 'Publiée sur le site et galerie d''accueil', 35)
on conflict (code) do update set
  label = excluded.label,
  sort_order = excluded.sort_order,
  updated_at = now();
