// Sicherung: JSON mit allen Tabellen, dazu für die ZIP eine Inventarliste (CSV für Tabellenprogramme) und die Fotos.
import { buildTree, typeLabel } from './types.js';
import { makeZip } from './zip.js';
import { dayText, priceText } from './warranty.js';

export const SCHEMA_VERSION = 9;

export function backupJson(data, householdName, now = new Date()) {
  return JSON.stringify({ app: 'qrate', schemaVersion: SCHEMA_VERSION, exportedAt: now.toISOString(), household: householdName ?? null, data }, null, 1);
}

// Alle Bilddateien, auf die die Sicherung verweist (Kistenfotos, Gegenstandsfotos, Belege)
export function filePaths(data) {
  const all = [...(data.box_photos ?? []).map(p => p.path), ...(data.item_photos ?? []).map(p => p.path),
    ...(data.purchases ?? []).map(p => p.receipt_path)];
  return [...new Set(all.filter(Boolean))];
}

// Zelle für CSV: Semikolon als Trenner (deutsches Excel), Anführungszeichen verdoppeln,
// Formeln (=, +, -, @ am Anfang) mit ' entschärfen.
function cell(v) {
  if (v == null) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[";\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}
// Datum als TT.MM.JJJJ; kommt als Text (Supabase) oder als Date-Objekt (Testdatenbank)
const day = v => dayText(v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : '');

// Eine Zeile pro Ding und pro Gegenstand (ohne entnommene), mit Ort, Kaufdaten und Beleg-Datei
export function inventoryCsv(data) {
  const boxes = data.boxes ?? [];
  const tree = buildTree(boxes);
  const byBox = new Map((data.purchases ?? []).filter(p => p.box_id).map(p => [p.box_id, p]));
  const byItem = new Map((data.purchases ?? []).filter(p => p.item_id).map(p => [p.item_id, p]));
  // Gegenstände einmal nach Ding gruppieren statt pro Ding alle durchsuchen
  const itemsBy = new Map();
  for (const i of data.items ?? []) {
    if (i.removed_at) continue;
    if (!itemsBy.has(i.box_id)) itemsBy.set(i.box_id, []);
    itemsBy.get(i.box_id).push(i);
  }
  const head = ['Ort', 'Ding', 'Typ', 'Gegenstand', 'Menge', 'Notiz', 'Gekauft am', 'Preis (EUR)', 'Händler', 'Seriennummer', 'Garantie bis', 'Beleg'];
  const buy = p => p ? [day(p.bought_on), priceText(p.price), p.shop, p.serial, day(p.warranty_until), p.receipt_path ? 'fotos/' + p.receipt_path : '']
    : ['', '', '', '', '', ''];
  const rows = [];
  // Pfad je Ding nur einmal berechnen, nicht in jedem Vergleich
  const sorted = boxes.map(b => ({ b, path: tree.path(b.id) }))
    .sort((x, y) => `${x.path} ${x.b.name}`.localeCompare(`${y.path} ${y.b.name}`, 'de'));
  for (const { b, path } of sorted) {
    const type = typeLabel(b.type);
    rows.push([path, b.name, type, '', '', b.note, ...buy(byBox.get(b.id))]);
    for (const i of itemsBy.get(b.id) ?? []) rows.push([path, b.name, type, i.name, i.qty, i.note, ...buy(byItem.get(i.id))]);
  }
  return '﻿' + [head, ...rows].map(r => r.map(cell).join(';')).join('\r\n') + '\r\n';
}

// ZIP: sicherung.json, inventar.csv, fotos/<pfad>. load(path) liefert den Blob; Fehler landen in fehlende-fotos.txt.
export async function backupZip(data, householdName, load, onProgress = () => {}) {
  const files = [
    { name: 'sicherung.json', data: backupJson(data, householdName) },
    { name: 'inventar.csv', data: inventoryCsv(data) }
  ];
  const paths = filePaths(data);
  // Vier Downloads gleichzeitig; Reihenfolge der Dateien bleibt wie in paths
  const blobs = new Array(paths.length);
  let next = 0, done = 0;
  const worker = async () => {
    while (next < paths.length) {
      const i = next++;
      try { blobs[i] = await load(paths[i]); } catch { blobs[i] = null; }
      onProgress(++done, paths.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, paths.length) }, worker));
  const missing = [];
  paths.forEach((path, i) => (blobs[i] ? files.push({ name: 'fotos/' + path, data: blobs[i] }) : missing.push(path)));
  if (missing.length) files.push({ name: 'fehlende-fotos.txt', data: missing.join('\r\n') + '\r\n' });
  return { blob: await makeZip(files), photos: paths.length - missing.length, missing: missing.length };
}
