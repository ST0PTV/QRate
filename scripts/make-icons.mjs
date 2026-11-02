// Erzeugt die App-Icons (PNG + SVG) ohne Fremdbibliothek: schwarzes Feld wie The Tracker, drei helle QR-Suchmuster und ein grauer Kisten-Strich.
// Aufruf: node scripts/make-icons.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [0, 0, 0], W = [236, 238, 240], G = [142, 142, 147];

// Zeichnung im 24er Raster, als Funktion (x, y in 0..24) -> Farbe
function color(x, y) {
  const finder = (ox, oy) => {
    const dx = x - ox, dy = y - oy;
    if (dx < 0 || dy < 0 || dx >= 7 || dy >= 7) return null;
    const ring = dx < 1 || dy < 1 || dx >= 6 || dy >= 6;
    const core = dx >= 2 && dy >= 2 && dx < 5 && dy < 5;
    return ring || core ? W : BG;
  };
  return finder(3, 3) ?? finder(14, 3) ?? finder(3, 14) ?? (x >= 14 && x < 21 && y >= 14 && y < 21 && (x < 15 || y < 15 || x >= 20 || y >= 20 || (x >= 17 && x < 18)) ? G : BG);
}

function png(size) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const c = color((x + 0.5) * 24 / size, (y + 0.5) * 24 / size);
      raw.set(c, y * (size * 3 + 1) + 1 + x * 3);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf) { let c = 0xFFFFFFFF; for (const b of buf) c = CRC[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

for (const s of [180, 192, 512]) writeFileSync(`icons/icon-${s}.png`, png(s));

const finderSvg = (x, y) => `<path d="M${x} ${y}h7v7h-7z M${x + 1} ${y + 1}v5h5v-5z M${x + 2} ${y + 2}h3v3h-3z" fill-rule="evenodd"/>`;
writeFileSync('icons/icon.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="#000"/><g fill="#ECEEF0">${finderSvg(3, 3)}${finderSvg(14, 3)}${finderSvg(3, 14)}</g><path fill="#8E8E93" d="M14 14h7v7h-7z M15 15v5h2v-5z M18 15v5h2v-5z" fill-rule="evenodd"/></svg>\n`);
console.log('Icons geschrieben');
