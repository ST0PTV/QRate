// Fotos vor dem Hochladen verkleinern: längste Seite höchstens 1600 px, JPEG.
// Ein Handyfoto (3–5 MB) wird so etwa 300–600 KB groß; der Speicher-Bucket nimmt höchstens 2 MB.
export async function shrinkImage(file, max = 1600, quality = 0.8) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(file));
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  return new Promise((ok, fail) => canvas.toBlob(b => (b ? ok(b) : fail(new Error('photo_unreadable'))), 'image/jpeg', quality));
}

// Freigestelltes Motiv (meist PNG aus „Auswahl kopieren“) verkleinern und als PNG behalten, damit die Transparenz bleibt.
// Längste Seite höchstens 1000 px: reicht für die Großansicht und bleibt meist unter 1 MB.
export async function shrinkCutout(blob, max = 1000) {
  const bmp = await createImageBitmap(blob).catch(() => { throw new Error('photo_unreadable'); });
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  const g = canvas.getContext('2d');
  g.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  // Anteil durchsichtiger Pixel: zeigt, ob wirklich freigestellt wurde
  const px = g.getImageData(0, 0, canvas.width, canvas.height).data;
  let clear = 0;
  for (let i = 3; i < px.length; i += 16) if (px[i] < 16) clear++;
  const cutout = clear / (px.length / 16) > 0.02;
  const out = await new Promise((ok, fail) => canvas.toBlob(b => (b ? ok(b) : fail(new Error('photo_unreadable'))), 'image/png'));
  return { blob: out, cutout };
}

// Bild aus der Zwischenablage holen. Muss direkt im Tipp-Ereignis starten, sonst lehnt iOS ab.
// Ergebnis: Blob, null (kein Bild drin) oder Fehler, wenn der Browser das Lesen nicht erlaubt.
export async function clipboardImage() {
  if (!navigator.clipboard?.read) throw new Error('clipboard_unavailable');
  const items = await navigator.clipboard.read();
  for (const it of items) {
    const type = it.types.find(t => t.startsWith('image/'));
    if (type) return it.getType(type);
  }
  return null;
}
