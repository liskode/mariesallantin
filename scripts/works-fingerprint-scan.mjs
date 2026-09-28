#!/usr/bin/env node
/**
 * Calcule file_sha256 + phash pour les images catalogue, écrit dans Supabase,
 * et affiche un rapport de doublons (exact + similaires).
 *
 * Usage :
 *   cd /chemin/vers/mariesallantin
 *   npm run works:dupes
 *   npm run works:dupes -- --threshold=12
 *   npm run works:dupes -- --dry-run          # calcule + rapport, pas d’UPDATE DB
 *   npm run works:dupes -- --report-only      # lit les empreintes déjà en base
 *   npm run works:dupes -- --force            # recalcule même si déjà renseigné
 *
 * phash = difference hash 64 bits (hex). Distance de Hamming faible = images proches.
 * Seuil par défaut : 10 (sur 64). Exact = même SHA-256.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const catalogueDir = path.join(root, 'media', 'catalogue');
const thumbDir = path.join(catalogueDir, '_thumbs');
const reportPath = path.join(root, 'media', '_dupes-report.json');

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const REPORT_ONLY = args.includes('--report-only');
const FORCE = args.includes('--force');
const thrArg = args.find((a) => a.startsWith('--threshold='));
const THRESHOLD = thrArg ? Math.max(0, parseInt(thrArg.split('=')[1], 10) || 10) : 10;

const RASTER = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.tif', '.tiff', '.avif']);

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

function workIdFromBasename(name) {
  const m = String(name || '').match(/^(MS\d{4})/i);
  return m ? m[1].toUpperCase() : null;
}

function findCatalogueFile(workId, imageExt) {
  const preferred = imageExt
    ? path.join(catalogueDir, `${workId}.${String(imageExt).replace(/^\./, '')}`)
    : null;
  if (preferred && fs.existsSync(preferred)) return preferred;

  if (!fs.existsSync(catalogueDir)) return null;
  const id = workId.toUpperCase();
  // Noms courts MS0001.jpeg ou historiques MS0001_SERIE_….jpeg
  for (const name of fs.readdirSync(catalogueDir)) {
    if (name.startsWith('_')) continue;
    const upper = name.toUpperCase();
    if (
      (upper.startsWith(id + '.') || upper.startsWith(id + '_')) &&
      RASTER.has(path.extname(name).toLowerCase())
    ) {
      return path.join(catalogueDir, name);
    }
  }
  return null;
}

function findThumbFile(workId) {
  if (!fs.existsSync(thumbDir)) return null;
  const webp = path.join(thumbDir, `${workId}.webp`);
  if (fs.existsSync(webp)) return webp;
  const upper = workId.toUpperCase() + '.';
  for (const name of fs.readdirSync(thumbDir)) {
    if (name.toUpperCase().startsWith(upper)) return path.join(thumbDir, name);
  }
  return null;
}

async function sha256File(absPath) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(absPath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

/**
 * Difference hash 64 bits → hex 16 chars.
 * Redimensionne en 9×8 niveaux de gris, compare pixels voisins horizontalement.
 */
async function computeDHash(Sharp, absPath) {
  const { data, info } = await Sharp(absPath)
    .rotate()
    .greyscale()
    .resize(9, 8, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.width !== 9 || info.height !== 8) {
    throw new Error(`dHash resize inattendu : ${info.width}x${info.height}`);
  }

  let bits = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = data[y * 9 + x];
      const right = data[y * 9 + x + 1];
      bits = (bits << 1n) | (left > right ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, '0');
}

function hammingHex64(a, b) {
  if (!a || !b || a.length !== 16 || b.length !== 16) return 64;
  let x = BigInt('0x' + a) ^ BigInt('0x' + b);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

async function fetchAllWorks(supabase) {
  const pageSize = 1000;
  const all = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('works')
      .select('id, title, filename_original, image_ext, file_sha256, phash')
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data?.length) break;
    all.push(...data);
    if (data.length < pageSize) break;
  }
  return all;
}

function buildReport(rows, threshold) {
  const withSha = rows.filter((r) => r.file_sha256);
  const withPhash = rows.filter((r) => r.phash);

  const bySha = new Map();
  for (const r of withSha) {
    const list = bySha.get(r.file_sha256) || [];
    list.push(r);
    bySha.set(r.file_sha256, list);
  }
  const exact = [...bySha.values()]
    .filter((g) => g.length > 1)
    .map((g) => ({
      kind: 'exact_sha256',
      file_sha256: g[0].file_sha256,
      works: g.map((w) => ({
        id: w.id,
        title: w.title,
        filename_original: w.filename_original,
      })),
    }))
    .sort((a, b) => a.works[0].id.localeCompare(b.works[0].id));

  const similar = [];
  for (let i = 0; i < withPhash.length; i++) {
    for (let j = i + 1; j < withPhash.length; j++) {
      const a = withPhash[i];
      const b = withPhash[j];
      // Même SHA déjà listé en exact — on peut aussi le noter, mais on saute pour alléger
      if (a.file_sha256 && b.file_sha256 && a.file_sha256 === b.file_sha256) continue;
      const dist = hammingHex64(a.phash, b.phash);
      if (dist <= threshold) {
        similar.push({
          kind: 'similar_phash',
          distance: dist,
          works: [
            { id: a.id, title: a.title, filename_original: a.filename_original, phash: a.phash },
            { id: b.id, title: b.title, filename_original: b.filename_original, phash: b.phash },
          ],
        });
      }
    }
  }
  similar.sort((a, b) => a.distance - b.distance || a.works[0].id.localeCompare(b.works[0].id));

  return {
    generated_at: new Date().toISOString(),
    threshold,
    totals: {
      works: rows.length,
      with_sha256: withSha.length,
      with_phash: withPhash.length,
      exact_groups: exact.length,
      similar_pairs: similar.length,
    },
    exact,
    similar,
  };
}

function printReport(report) {
  console.log('\n=== Doublons exacts (même SHA-256) ===');
  if (!report.exact.length) {
    console.log('  (aucun)');
  } else {
    for (const g of report.exact) {
      const ids = g.works.map((w) => w.id).join(', ');
      console.log(`  ${ids}`);
      for (const w of g.works) {
        console.log(`    - ${w.id}  ${w.filename_original || w.title || ''}`);
      }
    }
  }

  console.log(`\n=== Similaires (distance Hamming ≤ ${report.threshold}) ===`);
  if (!report.similar.length) {
    console.log('  (aucun)');
  } else {
    for (const p of report.similar) {
      const [a, b] = p.works;
      console.log(`  dist=${p.distance}  ${a.id} ↔ ${b.id}`);
      console.log(`    ${a.id}  ${a.filename_original || a.title || ''}`);
      console.log(`    ${b.id}  ${b.filename_original || b.title || ''}`);
    }
  }

  console.log('\nTotaux :', report.totals);
  console.log('Rapport JSON :', path.relative(root, reportPath));
}

async function main() {
  const env = loadEnvFile(path.join(root, '.env'));
  const url = env.SUPABASE_URL || process.env.SUPABASE_URL;
  const key =
    env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    console.error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis dans .env');
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  console.log('Lecture des œuvres…');
  let rows;
  try {
    rows = await fetchAllWorks(supabase);
  } catch (e) {
    const msg = e?.message || String(e);
    if (/file_sha256|phash|column/i.test(msg)) {
      console.error(
        'Colonnes file_sha256 / phash absentes.\n' +
          'Appliquez d’abord :\n' +
          '  supabase/migrations/20250928180000_works_image_fingerprints.sql\n' +
          'dans le SQL Editor Supabase (projet BaseArtMS), puis relancez.'
      );
    }
    throw e;
  }
  console.log(`${rows.length} œuvre(s).`);

  if (!REPORT_ONLY) {
    const Sharp = (await import('sharp')).default;
    let computed = 0;
    let skipped = 0;
    let missing = 0;
    let errors = 0;
    const updates = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const id = String(row.id).toUpperCase();
      if (!FORCE && row.file_sha256 && row.phash) {
        skipped++;
        continue;
      }

      const src = findCatalogueFile(id, row.image_ext);
      if (!src) {
        missing++;
        if (missing <= 10) console.warn(`  image manquante : ${id}`);
        continue;
      }

      const phashSrc = findThumbFile(id) || src;
      try {
        const [file_sha256, phash] = await Promise.all([
          sha256File(src),
          computeDHash(Sharp, phashSrc),
        ]);
        row.file_sha256 = file_sha256;
        row.phash = phash;
        updates.push({ id, file_sha256, phash });
        computed++;
        if (computed % 50 === 0 || i === rows.length - 1) {
          console.log(`  empreintes ${computed} calculées (fichier ${i + 1}/${rows.length})…`);
        }
      } catch (e) {
        errors++;
        console.warn(`  erreur ${id}:`, e?.message || e);
      }
    }

    console.log(
      `Calcul : ${computed} nouvelles, ${skipped} déjà présentes, ${missing} sans fichier, ${errors} erreur(s).`
    );

    if (!DRY && updates.length) {
      console.log(`Écriture Supabase (${updates.length})…`);
      // update ciblé (pas d’upsert) pour ne pas écraser les autres colonnes
      const batchSize = 40;
      for (let i = 0; i < updates.length; i += batchSize) {
        const batch = updates.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map(({ id, file_sha256, phash }) =>
            supabase.from('works').update({ file_sha256, phash }).eq('id', id)
          )
        );
        const failed = results.find((r) => r.error);
        if (failed?.error) throw failed.error;
        console.log(`  ${Math.min(i + batchSize, updates.length)}/${updates.length}`);
      }
    } else if (DRY) {
      console.log('Mode --dry-run : pas d’écriture Supabase.');
    }
  }

  const report = buildReport(rows, THRESHOLD);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  printReport(report);
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
