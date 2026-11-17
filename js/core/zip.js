// Kleiner ZIP-Schreiber ohne Kompression („stored“). Fotos sind schon komprimiert, Packen lohnt sich nicht.
// Ergebnis ist ein Blob aus Teilen. Bilder bleiben als Blob drin; ihre Bytes werden nur kurz für die Prüfsumme gelesen.
// Grenzen: höchstens 65535 Dateien und 4 GB (kein ZIP64), das reicht für eine Haushaltssicherung.

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// Datum und Uhrzeit im DOS-Format
function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  };
}

// files: [{ name, data }] mit data als Blob, Uint8Array oder Text
export async function makeZip(files, now = new Date()) {
  const enc = new TextEncoder();
  const { time, date } = dosTime(now);
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const bytes = typeof f.data === 'string' ? enc.encode(f.data)
      : f.data instanceof Uint8Array ? f.data : new Uint8Array(await f.data.arrayBuffer());
    const name = enc.encode(f.name);
    const crc = crc32(bytes);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034B50, true);
    local.setUint16(4, 20, true);       // benötigte Version
    local.setUint16(6, 0x0800, true);   // Namen in UTF-8
    local.setUint16(8, 0, true);        // ohne Kompression
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, bytes.length, true);
    local.setUint32(22, bytes.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(local, name, f.data instanceof Blob ? f.data : bytes);

    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014B50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true);
    c.setUint16(12, time, true);
    c.setUint16(14, date, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, bytes.length, true);
    c.setUint32(24, bytes.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.push(c, name);
    offset += 30 + name.length + bytes.length;
  }
  const size = central.reduce((s, x) => s + x.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054B50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
