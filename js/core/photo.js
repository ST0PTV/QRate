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
