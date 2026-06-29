-- Formats carrés : 0025 → 025C, libellé et dimensions (H = L = cm).

insert into public.formats (code, label, height_cm, width_cm, sort_order) values
  ('025C', 'Format carré (25cm x 25cm)', 25, 25, 4025),
  ('050C', 'Format carré (50cm x 50cm)', 50, 50, 4050),
  ('060C', 'Format carré (60cm x 60cm)', 60, 60, 4060),
  ('070C', 'Format carré (70cm x 70cm)', 70, 70, 4070),
  ('080C', 'Format carré (80cm x 80cm)', 80, 80, 4080),
  ('100C', 'Format carré (100cm x 100cm)', 100, 100, 4100),
  ('130C', 'Format carré (130cm x 130cm)', 130, 130, 4130),
  ('150C', 'Format carré (150cm x 150cm)', 150, 150, 4150),
  ('200C', 'Format carré (200cm x 200cm)', 200, 200, 4200)
on conflict (code) do update set
  label = excluded.label,
  height_cm = excluded.height_cm,
  width_cm = excluded.width_cm,
  sort_order = excluded.sort_order,
  updated_at = now();

update public.works set format_code = '025C' where format_code = '0025';
update public.works set format_code = '050C' where format_code = '0050';
update public.works set format_code = '060C' where format_code = '0060';
update public.works set format_code = '070C' where format_code = '0070';
update public.works set format_code = '080C' where format_code = '0080';
update public.works set format_code = '100C' where format_code = '0100';
update public.works set format_code = '130C' where format_code = '0130';
update public.works set format_code = '150C' where format_code = '0150';
update public.works set format_code = '200C' where format_code = '0200';

delete from public.formats
where code in ('0025', '0050', '0060', '0070', '0080', '0100', '0130', '0150', '0200');
