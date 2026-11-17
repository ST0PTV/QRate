// Sicherung: JSON mit allen Tabellen, dazu für die ZIP eine Inventarliste (CSV für Tabellenprogramme) und die Fotos.
import { buildTree, typeLabel } from './types.js';
import { makeZip } from './zip.js';

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
const price = n => (n == null ? '' : Number(n).toFixed(2).replace('.', ','));
// Datum als TT.MM.JJJJ; kommt als Text (Supabase) oder als Date-Objekt (Testdatenbank)
const day = v => {
  if (!v) return '';
  const iso = v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
  return iso.split('-').reverse().join('.');
};

// Eine Zeile pro Ding und pro Gegenstand (ohne entnommene), mit Ort, Kaufdaten und Beleg-Datei
export function inventoryCsv(data) {
  const boxes = data.boxes ?? [];
  const tree = buildTree(boxes);
  const byBox = new Map((data.purchases ?? []).filter(p => p.box_id).map(p => [p.box_id, p]));
  const byItem = new Map((data.purchases ?? []).filter(p => p.item_id).map(p => [p.item_id, p]));
  const boxName = new Map(boxes.map(b => [b.id, b.name]));
  const head = ['Ort', 'Ding', 'Typ', 'Gegenstand', 'Menge', 'Notiz', 'Gekauft am', 'Preis (EUR)', 'Händler', 'Seriennummer', 'Garantie bis', 'Beleg'];
  const buy = p => p ? [day(p.bought_on), price(p.price), p.shop, p.serial, day(p.warranty_until), p.receipt_path ? 'fotos/' + p.receipt_path : '']
    : ['', '', '', '', '', ''];
  const rows = [];
  const sorted = [...boxes].sort((a, b) => `${tree.path(a.id)} ${a.name}`.localeCompare(`${tree.path(b.id)} ${b.name}`, 'de'));
  for (const b of sorted) {
    rows.push([tree.path(b.id), b.name, typeLabel(b.type), '', '', b.note, ...buy(byBox.get(b.id))]);
    for (const i of (data.items ?? []).filter(x => x.box_id === b.id && !x.removed_at)) {
      rows.push([tree.path(b.id), boxName.get(b.id), typeLabel(b.type), i.name, i.qty, i.note, ...buy(byItem.get(i.id))]);
    }
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
  const missing = [];
  for (const [i, path] of paths.entries()) {
    onProgress(i + 1, paths.length);
    try {
      files.push({ name: 'fotos/' + path, data: await load(path) });
    } catch {
      missing.push(path);
    }
  }
  if (missing.length) files.push({ name: 'fehlende-fotos.txt', data: missing.join('\r\n') + '\r\n' });
  return { blob: await makeZip(files), photos: paths.length - missing.length, missing: missing.length };
}
