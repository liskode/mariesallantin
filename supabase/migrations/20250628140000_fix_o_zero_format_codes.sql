-- Corrige les codes format saisis avec la lettre O à la place du chiffre 0.
-- O12M → 012M (3 œuvres), O50F → 050F (1 œuvre).

update public.works set format_code = '012M' where format_code = 'O12M';
update public.works set format_code = '050F' where format_code = 'O50F';

delete from public.formats where code in ('O12M', 'O50F');
