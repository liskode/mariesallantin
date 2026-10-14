/**
 * Indice de qualité d'une photo (0–100), étalonné le 14/10/2026 sur les statuts photo
 * saisis à la main (OK vs « à refaire » : séparation correcte dans 83 % des comparaisons).
 *
 *   40 % netteté     : variance du laplacien sur l'image ramenée à 1024 px (log10, 1,7 → 3,0)
 *   40 % compression : bits par pixel du fichier (0,6 → 3, échelle log)
 *   20 % résolution  : mégapixels (1 → 8, échelle log)
 */
import fs from 'node:fs';

const clamp01 = (x) => Math.max(0, Math.min(1, x));

/**
 * @param {import('sharp')} sharp
 * @param {string | Buffer} input chemin ou contenu du fichier
 */
export async function measureImage(sharp, input) {
  const opts = { limitInputPixels: false };
  const meta = await sharp(input, opts).metadata();
  const { data, info } = await sharp(input, opts)
    .rotate()
    .greyscale()
    .resize(1024, 1024, { fit: 'inside' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const l = data[i - 1] + data[i + 1] + data[i - W] + data[i + W] - 4 * data[i];
      sum += l;
      sum2 += l * l;
      n++;
    }
  }
  const bytes = Buffer.isBuffer(input) ? input.length : fs.statSync(input).size;
  const rotated = (meta.orientation || 1) >= 5;
  const width = rotated ? meta.height : meta.width;
  const height = rotated ? meta.width : meta.height;
  return {
    width_px: width,
    height_px: height,
    megapixels: Math.round(((width * height) / 1e6) * 100) / 100,
    bits_per_pixel: Math.round(((bytes * 8) / (width * height)) * 1000) / 1000,
    laplacian_var: Math.round(n ? sum2 / n - (sum / n) ** 2 : 0),
  };
}

/** @param {ReturnType<typeof measureImage> extends Promise<infer T> ? T : never} m */
export function qualityScore(m) {
  const sharpness = clamp01((Math.log10(1 + m.laplacian_var) - 1.7) / (3.0 - 1.7));
  const compression = clamp01(Math.log(Math.max(m.bits_per_pixel, 1e-6) / 0.6) / Math.log(3 / 0.6));
  const resolution = clamp01(Math.log(Math.max(m.megapixels, 1e-6)) / Math.log(8));
  return Math.round(100 * (0.4 * sharpness + 0.4 * compression + 0.2 * resolution));
}
