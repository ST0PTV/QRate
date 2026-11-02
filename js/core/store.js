// Einziger Zugriff auf localStorage. Präfix kw_ (alle Apps teilen sich den Ursprung st0ptv.github.io).
const P = 'kw_';
const CACHE_MAX = 40;

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(P + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    if (value == null) localStorage.removeItem(P + key);
    else localStorage.setItem(P + key, JSON.stringify(value));
  } catch { /* Speicher voll oder gesperrt: App funktioniert ohne Cache weiter */ }
}

export const store = {
  household: () => read('household', null),
  setHousehold: id => write('household', id),

  // Code aus einem QR-Scan, der vor dem Login ankam
  pendingCode: () => read('pending_code', null),
  setPendingCode: code => write('pending_code', code),
  pendingInvite: () => read('pending_invite', null),
  setPendingInvite: token => write('pending_invite', token),

  // Kiste, die gerade verschoben wird (wartet auf den Scan eines Orts-Etiketts)
  moving: () => read('moving', null),
  setMoving: m => write('moving', m),

  email: () => read('email', ''),
  setEmail: e => write('email', e),

  // Zuletzt gesehene Scan-Ergebnisse, für sofortige Anzeige und Offline-Ansicht
  cached(code) {
    return read('cache', {})[code] ?? null;
  },
  cache(code, data) {
    const all = read('cache', {});
    all[code] = { at: new Date().toISOString(), data };
    const keys = Object.keys(all).sort((a, b) => all[b].at.localeCompare(all[a].at));
    for (const k of keys.slice(CACHE_MAX)) delete all[k];
    write('cache', all);
  },
  clearCache: () => write('cache', null),

  clearAll() {
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith(P)) localStorage.removeItem(k);
    } catch { /* ignorieren */ }
  }
};
