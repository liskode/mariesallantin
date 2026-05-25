/**
 * Lit largeur × hauteur (pixels) depuis l’en-tête JPEG (marqueurs SOF),
 * sans dépendance native (sips, sharp, etc.).
 */
import fs from 'fs';

/**
 * @param {Buffer} buf — au moins les premiers Ko du fichier suffisent en général
 * @returns {{ w: number, h: number } | null}
 */
export function readJpegDimensionsFromBuffer(buf) {
  if (!buf || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  const sofMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  while (i + 3 < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    let marker = buf[i + 1];
    i += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (i + 2 > buf.length) break;
    const segLen = buf.readUInt16BE(i);
    if (segLen < 2 || i + segLen > buf.length) break;
    if (sofMarkers.has(marker)) {
      const h = buf.readUInt16BE(i + 3);
      const w = buf.readUInt16BE(i + 5);
      if (w > 0 && h > 0) return { w, h };
      return null;
    }
    i += segLen;
  }
  return null;
}

/** Lit au plus `maxBytes` depuis le début du fichier (souvent suffisant pour SOF). */
export function readJpegDimensionsFromFile(absPath, maxBytes = 512 * 1024) {
  try {
    const fd = fs.openSync(absPath, 'r');
    try {
      const toRead = Math.min(maxBytes, fs.statSync(absPath).size);
      const buf = Buffer.alloc(toRead);
      fs.readSync(fd, buf, 0, toRead, 0);
      return readJpegDimensionsFromBuffer(buf);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}
