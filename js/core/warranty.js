// Hilfen für Kauf und Garantie: Datum als Text, Preis lesen, Jahre addieren, Zustand der Garantie.
import { inDays } from './ics.js';

export const dayText = s => (s ? s.split('-').reverse().join('.') : '');

// „1.299,90 €“, „1299.9“ oder „12“ → Zahl; leer → null; Unsinn → NaN
export function parsePrice(v) {
  let s = String(v ?? '').replace(/[\s€]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  return /^\d+(\.\d{1,2})?$/.test(s) ? Number(s) : NaN;
}

// Datum plus Jahre als YYYY-MM-DD (29.02. wird zum 28.02.)
export function plusYears(day, years) {
  const [y, m, d] = day.split('-').map(Number);
  const last = new Date(y + years, m, 0).getDate();
  return `${y + years}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

// Zustand der Garantie: abgelaufen, endet in 60 Tagen oder läuft
export function warrantyState(until, today = inDays(0)) {
  if (!until) return null;
  if (until < today) return 'over';
  return until <= inDays(60, new Date(today + 'T12:00')) ? 'soon' : 'ok';
}
