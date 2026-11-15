// Kleine UI-Helfer: Escaping, Icons, QR, Datumsformat, Meldungen.
import { humanNumber } from './code.js';
import { typeLabel } from './types.js';

// null/undefined ergeben einen leeren Text, nie "null".
export const esc = v => v == null ? '' : String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const tag = (kind, number) => `<span class="tag${kind === 'O' ? ' tag-o' : ''}">${humanNumber(kind, number)}</span>`;

export function fmtDay(iso) {
  return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
export function fmtTime(iso) {
  const d = new Date(iso);
  return `${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}, ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
}

// Eigene Strich-Icons (keine Emoji), 24er Raster, Farbe aus currentColor.
const ICONS = {
  home: '<path d="M3 10.5 12 4l9 6.5V20H3z"/><path d="M9.5 20v-5h5v5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>',
  scan: '<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4"/><path d="M9 9h2v2H9zM13 13h2v2h-2zM13 9h2M9 13v2"/>',
  label: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h3v4H7zM13 10h4M13 14h3"/>',
  people: '<circle cx="9" cy="9" r="3.2"/><path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6"/><circle cx="17" cy="8" r="2.5"/><path d="M16 13.2c2.4 0 4 1.4 4.5 4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  move: '<path d="M4 12h14M14 7l5 5-5 5"/>',
  takeout: '<path d="M4 13v6.5h16V13"/><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  print: '<path d="M7 9V4h10v5"/><rect x="4" y="9" width="16" height="7" rx="1.5"/><path d="M7 14h10v6H7z"/>',
  box: '<path d="M3.5 7.5 12 3.5l8.5 4v9L12 20.5l-8.5-4z"/><path d="M3.5 7.5 12 11.5l8.5-4M12 11.5v9"/>',
  pin: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  // Typen von Dingen
  rack: '<path d="M5 3v18M19 3v18M5 8h14M5 14h14M5 20h14"/>',
  cabinet: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M12 3v18M10 11v2M14 11v2"/>',
  shelf: '<path d="M3 12h18M5 12v3M19 12v3"/><rect x="6" y="6" width="5" height="6" rx="1"/><rect x="13" y="8" width="4" height="4" rx="1"/>',
  drawer: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 12h16M10 8.5h4M10 15.5h4"/>',
  pegboard: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 8h.01M12 8h.01M16 8h.01M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01"/>',
  bin: '<path d="M4 9h16l-1.5 10h-13z"/><path d="M3 6h18v3H3z"/>',
  case: '<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M9 8V5h6v3M3 13h18"/>',
  sack: '<path d="M8 4h8l-2 4c3 1 5 4 5 7a5 5 0 0 1-5 5h-4a5 5 0 0 1-5-5c0-3 2-6 5-7z"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  hanger: '<path d="M12 7a2 2 0 1 1 2-2"/><path d="M12 7v2L3 16h18l-9-7"/>',
  thing: '<path d="M4 7h11l2 3h3v5H4z"/><path d="M7 15v4M17 15v4"/>',
  tool: '<path d="M14.5 5.5a4 4 0 0 0-5 5L4 16l4 4 5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-3-1-1-3z"/>',
  chair: '<path d="M7 4v9h10V4M6 13h12v3H6zM7 16v4M17 16v4"/>',
  bike: '<circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="M6 16l4-7h5l3 7M10 9l3 7h-7M14 6h3"/>'
};
export const icon = (name, cls = '') =>
  `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;

// QR als SVG (vendor/qrcode.js, globale Variable "qrcode"). Fehlerkorrektur M reicht für Etiketten.
export function qrSvg(text) {
  if (typeof window.qrcode !== 'function') return '';
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  return `<svg viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges" aria-hidden="true"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

// Verlaufseintrag als Satz
export function eventText(e) {
  const d = e.detail ?? {};
  switch (e.action) {
    case 'box_created': return 'hat es angelegt';
    case 'box_moved': return d.to ? `hat es nach ${esc(d.to)} gestellt` : 'hat den Ort entfernt';
    case 'box_renamed': return `hat es in „${esc(d.name)}“ umbenannt`;
    case 'box_retyped': return `hat den Typ zu „${esc(typeLabel(d.type))}“ geändert`;
    case 'item_moved': return `hat „${esc(d.name)}“ hierher gelegt`;
    case 'item_added': return `hat ${d.qty > 1 ? esc(d.qty) + '× ' : ''}„${esc(d.name)}“ hinzugefügt`;
    case 'item_removed': return `hat „${esc(d.name)}“ entnommen`;
    case 'item_restored': return `hat „${esc(d.name)}“ zurückgelegt`;
    case 'item_changed': return `hat „${esc(d.name)}“ geändert`;
    default: return esc(e.action);
  }
}

// Darstellung anwenden: 'light' / 'dark' setzt html[data-theme], 'system' folgt dem Handy.
export function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === 'light' || mode === 'dark') root.dataset.theme = mode;
  else delete root.dataset.theme;
  const light = mode === 'light' || (mode !== 'dark' && matchMedia('(prefers-color-scheme: light)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', light ? '#F2F2F7' : '#000000');
}

let toastTimer;
export function toast(msg, kind = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, kind === 'error' ? 4500 : 2600);
}

export function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).then(() => true, () => false);
  return Promise.resolve(false);
}
