/**
 * Empreintes image : SHA-256 (octets) + difference hash 64 bits (similarité visuelle).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';

export function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function sha256FileSync(absPath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(absPath));
  return hash.digest('hex');
}

export async function sha256File(absPath) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(absPath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

/**
 * Difference hash 64 bits → hex 16 chars.
 * @param {import('sharp').Sharp} Sharp
 * @param {string | Buffer} input chemin ou buffer
 */
export async function computeDHash(Sharp, input) {
  const { data, info } = await Sharp(input)
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

export function hammingHex64(a, b) {
  if (!a || !b || a.length !== 16 || b.length !== 16) return 64;
  let x = BigInt('0x' + a) ^ BigInt('0x' + b);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

/** Seuil Hamming par défaut pour « suspect » (sur 64). */
export const DEFAULT_PHASH_THRESHOLD = 10;
