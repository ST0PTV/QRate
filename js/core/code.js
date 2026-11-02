// Etiketten-Codes: Crockford-Base32, 8 Zeichen. Reine Funktionen, ohne DOM und Netz.

export const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{8}$/;

// Lesbare Nummer: K-0042 für Kisten, O-007 für Orte.
export function humanNumber(kind, number) {
  if (number == null) return kind === 'O' ? 'O-???' : 'K-????';
  return kind === 'O' ? `O-${String(number).padStart(3, '0')}` : `K-${String(number).padStart(4, '0')}`;
}

// Crockford erlaubt O statt 0 und I/L statt 1 beim Eintippen.
export function cleanCode(s) {
  return String(s ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}

// Deutet eine Eingabe: ganze Adresse, nackter Code oder lesbare Nummer.
// Ergebnis: { code } | { kind, number } | null
export function parseLabelInput(input) {
  const s = String(input ?? '').trim();
  if (!s) return null;
  const human = s.toUpperCase().match(/^([KO])\s*-?\s*0*(\d{1,6})$/);
  if (human) return { kind: human[1], number: Number(human[2]) };
  let raw = s;
  try {
    const u = new URL(s);
    raw = u.searchParams.get('k') ?? u.pathname.split('/').filter(Boolean).at(-1) ?? '';
  } catch { /* keine Adresse */ }
  const code = cleanCode(raw);
  return CODE_RE.test(code) ? { code } : null;
}

export function labelUrl(appUrl, code) {
  const u = new URL(appUrl);
  u.search = '';
  u.hash = '';
  u.searchParams.set('k', code);
  return u.toString();
}

export function inviteUrl(appUrl, token) {
  const u = new URL(appUrl);
  u.search = '';
  u.hash = '';
  u.searchParams.set('invite', token);
  return u.toString();
}
