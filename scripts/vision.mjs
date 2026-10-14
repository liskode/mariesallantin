/**
 * Outils d'analyse d'image macOS (Vision) : compilés à la demande depuis tools/vision/*.swift
 * (nécessite les outils de développement Xcode : swiftc).
 *
 *   featureprints : empreinte visuelle de chaque image, œuvres les plus proches, voisines
 *   situscan      : tableaux détectés dans une scène, personnes, étiquettes de scène
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const toolsDir = path.join(root, 'tools', 'vision');

export function visionTool(name) {
  const src = path.join(toolsDir, name + '.swift');
  const bin = path.join(toolsDir, 'bin', name);
  if (!fs.existsSync(bin) || fs.statSync(bin).mtimeMs < fs.statSync(src).mtimeMs) {
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    console.error(`Compilation de ${name}…`);
    execFileSync('swiftc', ['-O', '-o', bin, src], { stdio: ['ignore', 'ignore', 'inherit'] });
  }
  return bin;
}

/** Lance un outil Vision ; la progression (stderr) est relayée à log. */
export function runVisionTool(name, args, log = (l) => console.error(l)) {
  const bin = visionTool(name);
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let last = '';
    p.stderr.on('data', (d) => {
      for (const line of String(d).split('\n').filter(Boolean)) {
        last = line;
        log(`  ${name} ${line}`);
      }
    });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${name} : code ${code} (${last})`))));
  });
}

export function writeList(file, paths) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, paths.join('\n') + '\n');
}

/** Images du catalogue (une par œuvre), triées. */
export function catalogueImages() {
  const dir = path.join(root, 'media', 'catalogue');
  return fs
    .readdirSync(dir)
    .filter((n) => /^MS\d{4}/i.test(n) && /\.(jpe?g|png|webp)$/i.test(n))
    .sort()
    .map((n) => path.join(dir, n));
}

export const CATALOGUE_CACHE = path.join(root, '.cache', 'vision');
