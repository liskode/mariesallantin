/**
 * Tri en ligne d'un export de photothèque (page tri-photos.html).
 *   GET  /api/triage/exports?token=…             exports disponibles + avancement
 *   GET  /api/triage?token=…&export=…             cartes, décisions, œuvres du catalogue
 *   POST /api/triage/decision { token, export, group, decision }
 * L'import (fiches, originaux, publication) reste fait en local à partir de ces décisions.
 */
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';
import { fetchAll } from '../_shared/fetch-all.ts';

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
  for (const prefix of ['/triage-api', '/functions/v1/triage-api']) {
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
  if (!url || !key) throw new Error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis');
  return createClient(url, key, { auth: { persistSession: false } });
}

const CATEGORIES = new Set(['duplicate', 'new', 'situ', 'ignore']);
const DECISION_KEYS = new Set(['category', 'work', 'keep', 'replace', 'best', 'situ_works', 'situ_type', 'caption', 'later', 'title', 'meta']);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const url = new URL(req.url);
  const path = routePath(url.pathname);

  try {
    if (req.method === 'GET' && path === '/api/health') {
      return jsonResponse(200, { ok: true, service: 'triage-api' });
    }

    if (req.method === 'GET' && path === '/api/triage/exports') {
      if (!checkToken(url.searchParams.get('token') || '')) return jsonResponse(403, { ok: false, error: 'token incorrect' });
      const supabase = createSupabase();
      const { data, error } = await supabase.from('photo_triage_exports').select('id, label, updated_at').order('updated_at', { ascending: false });
      if (error) throw error;
      return jsonResponse(200, { ok: true, exports: data || [] });
    }

    if (req.method === 'GET' && path === '/api/triage') {
      if (!checkToken(url.searchParams.get('token') || '')) return jsonResponse(403, { ok: false, error: 'token incorrect' });
      const exportId = url.searchParams.get('export') || '';
      const supabase = createSupabase();
      const { data: exp, error } = await supabase
        .from('photo_triage_exports')
        .select('id, label, triage, image_base, updated_at')
        .eq('id', exportId)
        .maybeSingle();
      if (error) throw error;
      if (!exp) return jsonResponse(404, { ok: false, error: 'export introuvable' });
      const decisions = await fetchAll((from, to) =>
        supabase
          .from('photo_triage_decisions')
          .select('group_id, decision, result')
          .eq('export_id', exportId)
          .order('group_id')
          .range(from, to)
      );
      const works = await fetchAll((from, to) =>
        supabase.from('works').select('id, title, year, image_quality').order('id').range(from, to)
      );
      const [series, formats, techniques] = await Promise.all([
        supabase.from('series').select('code, label').order('code'),
        supabase.from('formats').select('code, label, width_cm, height_cm').order('sort_order').order('code'),
        supabase.from('techniques').select('code, label').order('code'),
      ]);
      for (const r of [series, formats, techniques]) if (r.error) throw r.error;
      return jsonResponse(200, {
        ok: true,
        export: exp,
        decisions,
        works,
        meta: { series: series.data || [], formats: formats.data || [], techniques: techniques.data || [] },
      });
    }

    if (req.method === 'POST' && path === '/api/triage/decision') {
      const body = await req.json();
      if (!checkToken(String(body.token || ''))) return jsonResponse(403, { ok: false, error: 'token incorrect' });
      const exportId = String(body.export || '');
      const group = String(body.group || '');
      if (!/^g\d{4}$/.test(group)) return jsonResponse(400, { ok: false, error: 'carte invalide' });
      const decision: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(body.decision || {})) if (DECISION_KEYS.has(k)) decision[k] = v;
      if (decision.category && !CATEGORIES.has(String(decision.category))) {
        return jsonResponse(400, { ok: false, error: 'catégorie invalide' });
      }
      const supabase = createSupabase();
      const { data: exp, error: eErr } = await supabase.from('photo_triage_exports').select('triage').eq('id', exportId).maybeSingle();
      if (eErr) throw eErr;
      if (!exp) return jsonResponse(404, { ok: false, error: 'export introuvable' });
      const g = (exp.triage?.groups || []).find((x: { id: string }) => x.id === group);
      if (!g) return jsonResponse(404, { ok: false, error: 'carte introuvable' });
      const { data: prev } = await supabase
        .from('photo_triage_decisions')
        .select('decision, result')
        .eq('export_id', exportId)
        .eq('group_id', group)
        .maybeSingle();
      if (prev?.result) return jsonResponse(409, { ok: false, error: 'carte déjà importée : décision verrouillée' });
      const merged = { ...(body.replace_all ? {} : prev?.decision || {}), ...decision, at: new Date().toISOString() };
      const { error } = await supabase.from('photo_triage_decisions').upsert({
        export_id: exportId,
        group_id: group,
        decision: merged,
        photos: (g.photos || []).map((p: { name: string }) => p.name),
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      return jsonResponse(200, { ok: true, decision: merged });
    }

    return jsonResponse(404, { ok: false, error: 'not found' });
  } catch (e) {
    console.error(e);
    return jsonResponse(500, { ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
