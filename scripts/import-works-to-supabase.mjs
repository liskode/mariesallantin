#!/usr/bin/env node
/**
 * Importe media/works.json vers Supabase (table works + work_series + collectors + work_messages).
 *
 * Prérequis :
 *   1. Migrations Supabase exécutées (schéma + collectors/work_messages)
 *   2. Fichier .env à la racine avec SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY
 *      (le service role est requis : collectors privés + écriture works)
 *
 * Usage :
 *   node scripts/import-works-to-supabase.mjs
 *   node scripts/import-works-to-supabase.mjs chemin/vers/works.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { ensureCollectorByName } from './collector-utils.mjs';
import {
  splitUnderscoreCatalogueAfterMs,
  stripCatalogueIdPrefix,
  isUnderscoreMsCatalogueStem,
} from '../legend-filename.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const BATCH_SIZE = 50;
const YEAR_MIN = 1960;
const YEAR_MAX = 2030;

const PHOTO_MAP = {
  OK: 'OK',
  HQ: 'HQ',
  LQ: 'LQ',
  REDO: 'REDO',
  Redo: 'REDO',
};

const TECHNIQUE_PHRASES = [
  /\bacrylique\s+sur\s+toile\b/gi,
  /\bacrylique\s+sur\s+bois\b/gi,
  /\bhuile\s+sur\s+toile\b/gi,
  /\btempera\s+sur\s+toile\b/gi,
  /\bencre\s+sur\s+papier\b/gi,
  /\bencre\s+de\s+chine\b/gi,
  /\btechnique\s+mixte\b/gi,
  /\bpigments\s+sur\s+toile\b/gi,
  /\bacrylique\s+et\s+pigments\s+sur\s+toile\b/gi,
];

const DIMENSION_RE =
  /\b\d{1,4}\s*[xX×]\s*\d{1,4}\s*(?:cm|CM|mm|MM)?\b|\b\d{1,4}\s*X\s*\d{1,4}\s*cm\b/gi;

/** * ou _ suivi de majuscules en fin de chaîne (ex. *ROSSET, _FNAC). */
const ACQUIRER_SUFFIX_RE =
  /(?:\*|_)\s*([A-Z][A-Z0-9]*(?:\s+[A-Z][A-Z0-9]+)*)\s*$/;

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return {};
  const out = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function basenameFromMedia(media) {
  const fp = String(media || '').trim();
  const name = fp.includes('/') ? fp.slice(fp.lastIndexOf('/') + 1) : fp;
  return name;
}

function imageExtFromMedia(media) {
  const name = basenameFromMedia(media);
  const dot = name.lastIndexOf('.');
  if (dot < 0) return 'jpeg';
  const ext = name.slice(dot + 1).toLowerCase();
  if (ext === 'jpg') return 'jpeg';
  return ext;
}

function moToBytes(tailleMo) {
  if (tailleMo == null || tailleMo === '') return null;
  const n = Number(tailleMo);
  if (Number.isNaN(n) || n < 0) return null;
  return Math.round(n * 1024 * 1024);
}

function mapPhotoStatus(photo) {
  const p = String(photo || 'OK').trim();
  return PHOTO_MAP[p] || PHOTO_MAP[p.toUpperCase()] || 'OK';
}

/**
 * Extraction approximative depuis le nom de fichier (champ media).
 * Les valeurs doivent être validées manuellement après import.
 */
function extractFromFilename(media, knownFormats, knownTechniques) {
  const basename = basenameFromMedia(media);
  const lastDot = basename.lastIndexOf('.');
  const stem = lastDot >= 0 ? basename.slice(0, lastDot) : basename;

  let body = stem;
  if (isUnderscoreMsCatalogueStem(stem)) {
    const afterMs = stripCatalogueIdPrefix(stem);
    body = splitUnderscoreCatalogueAfterMs(afterMs).bodySansLegend;
  } else {
    const li = stem.lastIndexOf('-');
    body = li >= 0 ? stem.slice(0, li) : stem;
    body = stripCatalogueIdPrefix(body);
  }

  const upper = body.toUpperCase();
  const tokens = upper.split(/[_\s-]+/).filter(Boolean);

  let year = null;
  for (const tok of tokens) {
    if (/^(19|20)\d{2}$/.test(tok)) {
      const y = parseInt(tok, 10);
      if (y >= YEAR_MIN && y <= YEAR_MAX) {
        year = y;
        break;
      }
    }
  }

  let techniqueCode = null;
  for (const tok of tokens) {
    if (/^[A-Z]{3}$/.test(tok) && knownTechniques.has(tok)) {
      techniqueCode = tok;
      break;
    }
  }
  if (!techniqueCode) {
    for (const tok of tokens) {
      if (/^[A-Z]{3}$/.test(tok)) {
        techniqueCode = tok;
        break;
      }
    }
  }

  let formatCode = null;
  for (const tok of tokens) {
    if (knownFormats.has(tok)) {
      formatCode = tok;
      break;
    }
  }
  if (!formatCode) {
    for (const tok of tokens) {
      if (/^\d{3}[FP]$/i.test(tok) || /^HF\d{2}$/i.test(tok)) {
        formatCode = tok.toUpperCase();
        break;
      }
    }
  }

  return { year, formatCode, techniqueCode, body };
}

function extractAcquirer(rawTitle) {
  const t = String(rawTitle || '').trim();
  const m = ACQUIRER_SUFFIX_RE.exec(t);
  if (!m) return { acquirer: null, titleWithoutAcquirer: t };
  const acquirer = m[1].trim().replace(/\s+/g, ' ');
  const titleWithoutAcquirer = t.slice(0, m.index).trim();
  return { acquirer, titleWithoutAcquirer };
}

function cleanTitle(rawTitle) {
  const { acquirer, titleWithoutAcquirer } = extractAcquirer(rawTitle);
  let t = titleWithoutAcquirer;

  for (const re of TECHNIQUE_PHRASES) {
    t = t.replace(re, ' ');
  }

  t = t.replace(DIMENSION_RE, ' ');
  t = t.replace(/\b(19|20)\d{2}\b/g, ' ');
  t = t.replace(/\b(HST|AST|ASB|TST|TSB|INK|HUI)\b/gi, ' ');
  t = t.replace(/\s*[,;_]\s*$/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  t = t.replace(/^[-–—]\s*/, '').trim();

  return { title: t || titleWithoutAcquirer.trim() || rawTitle.trim(), acquirer };
}

function titleStillHasDimensions(title) {
  return DIMENSION_RE.test(title);
}

function buildWarnings(ctx) {
  const messages = [];
  if (titleStillHasDimensions(ctx.cleanedTitle)) {
    messages.push('Le titre nettoyé contient encore des dimensions (pattern NxNN cm).');
  }
  if (ctx.techniqueCode && !ctx.knownTechniques.has(ctx.techniqueCode)) {
    messages.push(
      `Code technique extrait du fichier (« ${ctx.techniqueCode} ») absent de la table techniques.`
    );
  }
  if (ctx.formatCode && !ctx.knownFormats.has(ctx.formatCode)) {
    messages.push(
      `Code format extrait du fichier (« ${ctx.formatCode} ») absent de la table formats.`
    );
  }
  if (!ctx.series.length) {
    messages.push('Aucune série renseignée pour cette œuvre.');
  }
  if (ctx.year == null || ctx.year < YEAR_MIN || ctx.year > YEAR_MAX) {
    messages.push(
      `Année absente ou hors plage ${YEAR_MIN}-${YEAR_MAX} (valeur extraite : ${ctx.year ?? '—'}).`
    );
  }
  return messages;
}

async function fetchReferenceSets(supabase) {
  const [formatsRes, techniquesRes] = await Promise.all([
    supabase.from('formats').select('code'),
    supabase.from('techniques').select('code'),
  ]);
  if (formatsRes.error) throw formatsRes.error;
  if (techniquesRes.error) throw techniquesRes.error;
  return {
    knownFormats: new Set((formatsRes.data || []).map((r) => r.code)),
    knownTechniques: new Set((techniquesRes.data || []).map((r) => r.code)),
  };
}

async function ensureCollector(supabase, name, collectorType, cache) {
  return ensureCollectorByName(
    supabase,
    { name, collector_type: collectorType || 'Particulier' },
    cache
  );
}

async function deleteWorkMessages(supabase, workIds) {
  if (!workIds.length) return;
  const { error } = await supabase.from('work_messages').delete().in('work_id', workIds);
  if (error) throw error;
}

async function main() {
  const env = loadEnvFile(path.join(root, '.env'));
  const url = env.SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey =
    env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = env.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const key = serviceKey || anonKey;

  if (!url || !key) {
    console.error(
      'Variables manquantes : SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY (recommandé) dans .env'
    );
    process.exit(1);
  }
  if (!serviceKey) {
    console.warn(
      'Attention : SUPABASE_SERVICE_ROLE_KEY absent — collectors privés et écritures peuvent échouer.'
    );
  }

  const worksPath = path.resolve(process.argv[2] || path.join(root, 'media', 'works.json'));
  const raw = JSON.parse(fs.readFileSync(worksPath, 'utf8'));
  const works = raw.works || [];
  if (!works.length) {
    console.error('Aucune œuvre dans', worksPath);
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { knownFormats, knownTechniques } = await fetchReferenceSets(supabase);

  const stats = {
    imported: 0,
    warnings: 0,
    collectors: new Set(),
    errors: 0,
  };
  const collectorCache = new Map();

  for (let i = 0; i < works.length; i += BATCH_SIZE) {
    const batch = works.slice(i, i + BATCH_SIZE);
    const rows = [];
    const seriesRows = [];
    const messageRows = [];
    const batchIds = [];

    for (let j = 0; j < batch.length; j++) {
      const w = batch[j];
      try {
        const id = String(w.id || '').trim();
        if (!/^MS\d{4}$/i.test(id)) {
          throw new Error(`id invalide : ${w.id}`);
        }

        const rawTitle = String(w.title || '').trim();
        const { title: cleanedTitle, acquirer } = cleanTitle(rawTitle);
        const { year, formatCode, techniqueCode } = extractFromFilename(
          w.media,
          knownFormats,
          knownTechniques
        );
        const series = Array.isArray(w.series)
          ? [...new Set(w.series.map((s) => String(s).trim().toUpperCase()).filter(Boolean))]
          : [];

        const warnings = buildWarnings({
          cleanedTitle,
          techniqueCode,
          formatCode,
          series,
          year,
          knownFormats,
          knownTechniques,
        });

        const publicationStatus = warnings.length ? 'M' : 'N';

        let collectorCode = null;
        if (acquirer) {
          collectorCode = await ensureCollector(supabase, acquirer, 'Particulier', collectorCache);
          stats.collectors.add(acquirer);
        }

        const row = {
          id,
          title: cleanedTitle,
          filename_original: rawTitle,
          year: year ?? null,
          format_code: formatCode && knownFormats.has(formatCode) ? formatCode : null,
          technique_code:
            techniqueCode && knownTechniques.has(techniqueCode) ? techniqueCode : null,
          publication_status_code: publicationStatus,
          photo_status_code: mapPhotoStatus(w.photo),
          file_size_bytes: moToBytes(w.tailleMo),
          image_ext: imageExtFromMedia(w.media),
          collector_code: collectorCode,
          sort_order: i + j,
        };

        rows.push(row);
        batchIds.push(id);

        for (const code of series) {
          seriesRows.push({ work_id: id, series_code: code });
        }

        for (const message of warnings) {
          messageRows.push({ work_id: id, message });
          stats.warnings++;
        }
      } catch (e) {
        stats.errors++;
        console.error(`[${w.id || '?'}] préparation :`, e.message || e);
      }
    }

    if (!rows.length) continue;

    try {
      const { error: upsertErr } = await supabase.from('works').upsert(rows, { onConflict: 'id' });
      if (upsertErr) throw upsertErr;
      stats.imported += rows.length;

      await deleteWorkMessages(supabase, batchIds);

      if (seriesRows.length) {
        await supabase.from('work_series').delete().in('work_id', batchIds);
        const { error: seriesErr } = await supabase.from('work_series').insert(seriesRows);
        if (seriesErr) throw seriesErr;
      } else {
        await supabase.from('work_series').delete().in('work_id', batchIds);
      }

      if (messageRows.length) {
        const { error: msgErr } = await supabase.from('work_messages').insert(messageRows);
        if (msgErr) throw msgErr;
      }

      console.log(
        `Lot ${Math.floor(i / BATCH_SIZE) + 1} : ${rows.length} œuvre(s), ${messageRows.length} avertissement(s)`
      );
    } catch (e) {
      stats.errors++;
      console.error(`Lot ${Math.floor(i / BATCH_SIZE) + 1} :`, e.message || e);
    }
  }

  console.log('\n--- Résumé import ---');
  console.log('Œuvres importées :', stats.imported, '/', works.length);
  console.log('Avertissements générés :', stats.warnings);
  console.log('Acquéreurs distincts :', stats.collectors.size);
  console.log('Erreurs :', stats.errors);
  if (stats.errors > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
