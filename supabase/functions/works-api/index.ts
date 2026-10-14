import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';
import { fetchAll } from '../_shared/fetch-all.ts';
import { sortFormats } from '../_shared/format-sort.ts';
import {
  fetchExistingWorkIds,
  formatWorkId,
  normalizeImportMode,
  normalizeImportOverrides,
  applyOverridesToPlan,
  planWorkImports,
  resolveNextSequentialStart,
} from '../_shared/work-import.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function routePath(pathname: string): string {
  const prefixes = ['/works-api', '/functions/v1/works-api'];
  for (const prefix of prefixes) {
    if (pathname === prefix) return '/';
    if (pathname.startsWith(prefix + '/')) return pathname.slice(prefix.length);
  }
  return pathname;
}

function checkToken(token: string): boolean {
  const expected = Deno.env.get('CATALOGUE_EDITOR_TOKEN') || '';
  return expected !== '' && token === expected;
}

function createSupabase(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !key) {
    throw new Error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function parseYear(v: unknown): number | null {
  if (v === '' || v == null) return null;
  const n = parseInt(String(v), 10);
  if (Number.isNaN(n) || n < 1000 || n > 9999) return null;
  return n;
}

function parseCm(v: unknown): number | null {
  if (v === '' || v == null) return null;
  const n = parseFloat(String(v).replace(',', '.'));
  if (Number.isNaN(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function normalizeWorkInput(raw: Record<string, unknown>) {
  const id = String(raw.id || '').trim().toUpperCase();
  if (!/^MS\d{4}$/.test(id)) {
    throw new Error(`id invalide : ${id || '(vide)'}`);
  }
  const seriesRaw = Array.isArray(raw.series_codes) ? raw.series_codes : [];
  const series_codes = [
    ...new Set(
      seriesRaw.map((c) => String(c || '').trim().toUpperCase()).filter(Boolean)
    ),
  ];
  return {
    row: {
      id,
      title: String(raw.title || '').trim(),
      year: parseYear(raw.year),
      format_code: String(raw.format_code || '').trim().toUpperCase() || null,
      technique_code: String(raw.technique_code || '').trim().toUpperCase() || null,
      publication_status_code: String(raw.publication_status_code || 'N').trim().toUpperCase(),
      photo_status_code: raw.photo_status_code
        ? String(raw.photo_status_code).trim().toUpperCase()
        : null,
      photo_credit: String(raw.photo_credit || '').trim(),
      collector_code: String(raw.collector_code || '').trim().toUpperCase() || null,
      width_cm: parseCm(raw.width_cm),
      height_cm: parseCm(raw.height_cm),
      sort_order: Number.isFinite(Number(raw.sort_order)) ? Number(raw.sort_order) : 0,
    },
    series_codes,
  };
}

async function fetchMeta(supabase: SupabaseClient) {
  const [formats, techniques, series, collectors, publication_statuses, photo_statuses] =
    await Promise.all([
      supabase
        .from('formats')
        .select('code, label, width_cm, height_cm')
        .order('code'),
      supabase.from('techniques').select('code, label').order('code'),
      supabase.from('series').select('code, label').order('sort_order').order('code'),
      supabase.from('collectors').select('code, name').order('name'),
      supabase
        .from('publication_statuses')
        .select('code, label')
        .order('sort_order')
        .order('code'),
      supabase.from('photo_statuses').select('code, label').order('sort_order').order('code'),
    ]);
  for (const r of [formats, techniques, series, collectors, publication_statuses, photo_statuses]) {
    if (r.error) throw r.error;
  }
  return {
    formats: sortFormats(formats.data || []),
    techniques: techniques.data || [],
    series: series.data || [],
    collectors: (collectors.data || []).map((c) => ({
      code: c.code,
      label: c.name || c.code,
    })),
    publication_statuses: publication_statuses.data || [],
    photo_statuses: photo_statuses.data || [],
  };
}

async function fetchWorksWithSeries(supabase: SupabaseClient) {
  const works = await fetchAll((from, to) =>
    supabase
      .from('works')
      .select(
        'id, title, year, format_code, technique_code, publication_status_code, photo_status_code, photo_credit, collector_code, width_cm, height_cm, filename_original, image_ext, sort_order, updated_at, image_quality, image_quality_details'
      )
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)
  );

  const links = await fetchAll((from, to) =>
    supabase
      .from('work_series')
      .select('work_id, series_code')
      .order('work_id')
      .order('series_code')
      .range(from, to)
  );

  const byWork = new Map<string, string[]>();
  for (const row of links || []) {
    const wid = row.work_id as string;
    const code = row.series_code as string;
    if (!byWork.has(wid)) byWork.set(wid, []);
    byWork.get(wid)!.push(code);
  }

  return (works || []).map((w) => ({
    ...w,
    series_codes: byWork.get(w.id as string) || [],
  }));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = routePath(url.pathname);

  try {
    if (req.method === 'GET' && path === '/api/health') {
      return jsonResponse(200, { ok: true, service: 'works-api' });
    }

    if (req.method === 'GET' && path === '/api/works/meta') {
      const token = url.searchParams.get('token') || '';
      if (!checkToken(token)) {
        return jsonResponse(403, { ok: false, error: 'token incorrect' });
      }
      const supabase = createSupabase();
      const meta = await fetchMeta(supabase);
      return jsonResponse(200, { ok: true, meta });
    }

    if (req.method === 'GET' && path === '/api/works') {
      const token = url.searchParams.get('token') || '';
      if (!checkToken(token)) {
        return jsonResponse(403, { ok: false, error: 'token incorrect' });
      }
      const supabase = createSupabase();
      const works = await fetchWorksWithSeries(supabase);
      return jsonResponse(200, { ok: true, works });
    }

    if (req.method === 'GET' && path === '/api/works/next-id') {
      const token = url.searchParams.get('token') || '';
      if (!checkToken(token)) {
        return jsonResponse(403, { ok: false, error: 'token incorrect' });
      }
      const supabase = createSupabase();
      const start = await resolveNextSequentialStart(supabase);
      return jsonResponse(200, { ok: true, next_id: formatWorkId(start) });
    }

    if (req.method === 'POST' && path === '/api/works/import/plan') {
      const body = await req.json();
      if (!checkToken(String(body.token || ''))) {
        return jsonResponse(403, { ok: false, error: 'token incorrect' });
      }
      const importMode = normalizeImportMode(String(body.import_mode || body.id_mode || ''));
      const photoStatusCode = String(body.photo_status_code || '').trim().toUpperCase() || null;
      const files = Array.isArray(body.files) ? body.files : [];
      const supabase = createSupabase();
      const meta = await fetchMeta(supabase);
      const catalog = {
        knownSeries: new Set((meta.series || []).map((s) => s.code as string)),
        knownTechniques: new Set((meta.techniques || []).map((t) => t.code as string)),
        knownFormats: new Set((meta.formats || []).map((f) => f.code as string)),
        knownPhotoStatuses: new Set((meta.photo_statuses || []).map((p) => p.code as string)),
        photoStatusCode,
      };
      const existingIds = await fetchExistingWorkIds(supabase);
      const sequentialStart = await resolveNextSequentialStart(supabase);
      const plan = planWorkImports(
        files.map((f: { originalName?: string; name?: string }) => ({
          originalName: String(f.originalName || f.name || ''),
        })),
        importMode,
        existingIds,
        sequentialStart,
        catalog
      );
      applyOverridesToPlan(plan, normalizeImportOverrides(body.overrides), catalog);
      return jsonResponse(200, {
        ok: true,
        import_mode: importMode,
        simulation_only: true,
        next_sequential_id: formatWorkId(sequentialStart),
        plan,
      });
    }

    if (req.method === 'POST' && path === '/api/works/import') {
      const body = await req.json();
      if (!checkToken(String(body.token || ''))) {
        return jsonResponse(403, { ok: false, error: 'token incorrect' });
      }
      return jsonResponse(403, {
        ok: false,
        error:
          'import réservé à l’API locale — lancez npm run works:api puis ouvrez http://127.0.0.1:47835/',
      });
    }

    if (req.method === 'POST' && path === '/api/works/save') {
      const body = await req.json();
      if (!checkToken(String(body.token || ''))) {
        return jsonResponse(403, { ok: false, error: 'token incorrect' });
      }
      const rows = Array.isArray(body.works) ? body.works : [];
      if (!rows.length) {
        return jsonResponse(400, { ok: false, error: 'aucune œuvre à enregistrer' });
      }

      const supabase = createSupabase();
      const ids: string[] = [];

      for (const raw of rows) {
        const { row, series_codes } = normalizeWorkInput(raw as Record<string, unknown>);
        ids.push(row.id);
        const { error } = await supabase.from('works').upsert(row, { onConflict: 'id' });
        if (error) throw error;

        const { error: delErr } = await supabase.from('work_series').delete().eq('work_id', row.id);
        if (delErr) throw delErr;

        if (series_codes.length) {
          const payload = series_codes.map((code) => ({
            work_id: row.id,
            series_code: code,
          }));
          const { error: insErr } = await supabase.from('work_series').insert(payload);
          if (insErr) throw insErr;
        }
      }

      const works = await fetchWorksWithSeries(supabase);
      return jsonResponse(200, { ok: true, works, saved: ids.length });
    }

    if (req.method === 'POST' && path === '/api/works/delete') {
      const body = await req.json();
      if (!checkToken(String(body.token || ''))) {
        return jsonResponse(403, { ok: false, error: 'token incorrect' });
      }
      const workId = String(body.work_id || '').trim().toUpperCase();
      if (!/^MS\d{4}$/.test(workId)) {
        return jsonResponse(400, { ok: false, error: 'work_id invalide' });
      }
      const supabase = createSupabase();
      // Une série dont l'icône est cette œuvre bloquerait la suppression : on retire l'icône
      const { error: iErr } = await supabase.from('series').update({ icon_work_id: null }).eq('icon_work_id', workId);
      if (iErr) throw iErr;
      const { error } = await supabase.from('works').delete().eq('id', workId);
      if (error) throw error;
      const works = await fetchWorksWithSeries(supabase);
      return jsonResponse(200, { ok: true, works, deleted: workId });
    }

    // ---- Doublons possibles (outil ♊)
    if (req.method === 'GET' && path === '/api/similar') {
      const token = url.searchParams.get('token') || '';
      if (!checkToken(token)) {
        return jsonResponse(403, { ok: false, error: 'token incorrect' });
      }
      const supabase = createSupabase();
      const pairs = await fetchAll((from, to) =>
        supabase
          .from('work_similarities')
          .select('work_a, work_b, distance')
          .eq('status', 'open')
          .order('distance', { ascending: true })
          .order('work_a')
          .order('work_b')
          .range(from, to)
      );
      return jsonResponse(200, { ok: true, pairs });
    }

    if (req.method === 'POST' && path === '/api/similar/dismiss') {
      const body = await req.json();
      if (!checkToken(String(body.token || ''))) {
        return jsonResponse(403, { ok: false, error: 'token incorrect' });
      }
      const pairs = Array.isArray(body.pairs) ? body.pairs : [];
      const supabase = createSupabase();
      for (const p of pairs) {
        const [a, b] = [String(p[0] || '').toUpperCase(), String(p[1] || '').toUpperCase()].sort();
        if (!/^MS\d{4}$/.test(a) || !/^MS\d{4}$/.test(b)) continue;
        const { error } = await supabase
          .from('work_similarities')
          .update({ status: 'dismissed', updated_at: new Date().toISOString() })
          .eq('work_a', a)
          .eq('work_b', b);
        if (error) throw error;
      }
      return jsonResponse(200, { ok: true, dismissed: pairs.length });
    }

    if (req.method === 'POST' && path === '/api/works/merge') {
      const body = await req.json();
      if (!checkToken(String(body.token || ''))) {
        return jsonResponse(403, { ok: false, error: 'token incorrect' });
      }
      const keep = String(body.keep || '').trim().toUpperCase();
      const remove = [...new Set((Array.isArray(body.remove) ? body.remove : []).map((x: unknown) => String(x).trim().toUpperCase()))];
      if (!/^MS\d{4}$/.test(keep) || !remove.length || remove.some((r) => !/^MS\d{4}$/.test(r) || r === keep)) {
        return jsonResponse(400, { ok: false, error: 'œuvres à fusionner invalides' });
      }
      const supabase = createSupabase();
      const { data: found, error: fErr } = await supabase.from('works').select('id').in('id', [keep, ...remove]);
      if (fErr) throw fErr;
      if ((found || []).length !== remove.length + 1) {
        return jsonResponse(404, { ok: false, error: 'œuvre introuvable (déjà fusionnée ?)' });
      }

      // 1. Valeurs retenues sur la fiche conservée
      const FIELDS = ['title', 'year', 'format_code', 'technique_code', 'collector_code', 'publication_status_code',
        'photo_status_code', 'photo_credit', 'width_cm', 'height_cm'];
      const patch: Record<string, unknown> = {};
      for (const k of FIELDS) if (body.fields && k in body.fields) patch[k] = body.fields[k];
      if (Object.keys(patch).length) {
        patch.updated_at = new Date().toISOString();
        const { error } = await supabase.from('works').update(patch).eq('id', keep);
        if (error) throw error;
      }
      // 2. Séries : liste choisie (par défaut, réunion des séries)
      if (Array.isArray(body.series)) {
        const codes = [...new Set(body.series.map((c: unknown) => String(c).trim().toUpperCase()).filter(Boolean))];
        const { error: dErr } = await supabase.from('work_series').delete().eq('work_id', keep);
        if (dErr) throw dErr;
        if (codes.length) {
          const { error } = await supabase.from('work_series').insert(codes.map((series_code) => ({ work_id: keep, series_code })));
          if (error) throw error;
        }
      }
      // 3. Tout ce qui pointait vers les fiches supprimées est reporté sur la fiche conservée
      for (const table of ['work_photo_links', 'related_media_works']) {
        const key = table === 'work_photo_links' ? 'photo_id' : 'media_id';
        const { data: rows, error } = await supabase.from(table).select(key).in('work_id', remove);
        if (error) throw error;
        const ids = [...new Set((rows || []).map((r: Record<string, unknown>) => r[key]))];
        if (ids.length) {
          const { error: uErr } = await supabase
            .from(table)
            .upsert(ids.map((id) => ({ [key]: id, work_id: keep })), { onConflict: key + ',work_id', ignoreDuplicates: true });
          if (uErr) throw uErr;
        }
      }
      {
        const { error } = await supabase.from('work_messages').update({ work_id: keep }).in('work_id', remove);
        if (error) throw error;
        const { error: sErr } = await supabase.from('series').update({ icon_work_id: keep }).in('icon_work_id', remove);
        if (sErr) throw sErr;
      }
      // 4. Suppression des fiches fusionnées (leurs images seront archivées à la prochaine publication)
      const { error: delErr } = await supabase.from('works').delete().in('id', remove);
      if (delErr) throw delErr;
      const works = await fetchWorksWithSeries(supabase);
      return jsonResponse(200, { ok: true, kept: keep, removed: remove, works });
    }

    return jsonResponse(404, { ok: false, error: 'not found' });
  } catch (e) {
    console.error(e);
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse(500, { ok: false, error: message });
  }
});
