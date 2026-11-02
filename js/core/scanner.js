// QR-Scanner mit der Kamera (ZXing, vendor/zxing.min.js, Apache-2.0).
// Übernommen aus The Tracker js/features/food/barcode.js (ST0PTV, MIT), auf QR-Codes umgestellt.
// Nötig für die installierte Homescreen-App: Die normale Kamera öffnet Links in Safari, nicht in der App.
// Kamera läuft nur, solange der Scanner sichtbar ist.

let zxing = null;
function loadZxing() {
  if (globalThis.ZXing) return Promise.resolve(globalThis.ZXing);
  if (zxing) return zxing;
  zxing = new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = 'vendor/zxing.min.js';
    s.onload = () => ok(globalThis.ZXing);
    s.onerror = () => { zxing = null; fail(new Error('ZXing nicht geladen')); };
    document.head.appendChild(s);
  });
  return zxing;
}

let reader = null;
let stream = null;
let videoEl = null;

async function getStream() {
  const res = { width: { ideal: 1280 }, height: { ideal: 720 } };
  let st = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, ...res } });
  try {
    const tr = st.getVideoTracks()[0];
    if (/ultra/i.test(tr.label || '')) {
      const back = (await navigator.mediaDevices.enumerateDevices())
        .find(d => d.kind === 'videoinput' && /back|rück|hinter/i.test(d.label) && !/ultra|tele/i.test(d.label));
      if (back) {
        st.getTracks().forEach(t => t.stop());
        st = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: back.deviceId }, ...res } });
      }
    }
  } catch { /* Standardkamera behalten */ }
  try {
    const tr = st.getVideoTracks()[0];
    const cap = tr.getCapabilities ? tr.getCapabilities() : {};
    if (cap.focusMode && cap.focusMode.includes('continuous')) await tr.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
  } catch { /* Fokus nicht steuerbar */ }
  return st;
}

/**
 * Startet den Scanner im video-Element. onCode(text) einmal pro erkanntem Code (derselbe erst wieder nach 3 s).
 * onError(text) bei fehlender Kamera oder Berechtigung.
 */
export async function startScanner(video, { onCode, onError }) {
  stopScanner();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { onError('Kamera nicht verfügbar. Bitte die Nummer eintippen.'); return; }
  let Z;
  try { Z = await loadZxing(); } catch { onError('Scanner konnte nicht geladen werden. Bitte die Nummer eintippen.'); return; }
  const hints = new Map();
  hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.QR_CODE]);
  const r = new Z.BrowserMultiFormatReader(hints, 120);
  reader = r;
  videoEl = video;
  let seen = '', seenAt = 0;
  try {
    const st = await getStream();
    if (reader !== r) { st.getTracks().forEach(t => t.stop()); return; } // inzwischen geschlossen
    stream = st;
    await r.decodeFromStream(st, video, result => {
      if (!result) return;
      const text = result.getText(), now = Date.now();
      const again = text === seen && now - seenAt < 3000;
      seen = text; seenAt = now;
      if (again) return;
      if (navigator.vibrate) navigator.vibrate(30);
      onCode(text);
    });
  } catch {
    if (reader === r) onError('Kein Kamerazugriff. Erlaube die Kamera in den Einstellungen oder tippe die Nummer ein.');
  }
}

export function stopScanner() {
  if (reader) { try { reader.stopContinuousDecode(); } catch { /* ok */ } reader = null; }
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  if (videoEl) { try { videoEl.pause(); videoEl.srcObject = null; } catch { /* ok */ } videoEl = null; }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') stopScanner(); });
}
