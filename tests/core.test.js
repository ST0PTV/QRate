import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLabelInput, humanNumber, cleanCode, labelUrl, inviteUrl } from '../js/core/code.js';
import { reminderIcs, inDays } from '../js/core/ics.js';
import { parseQuick } from '../js/core/parse.js';

test('humanNumber', () => {
  assert.equal(humanNumber('K', 42), 'K-0042');
  assert.equal(humanNumber('O', 7), 'O-007');
  assert.equal(humanNumber('K', null), 'K-????');
  assert.equal(humanNumber('Q', 42), '#0042');
});

test('cleanCode: Crockford-Verwechsler', () => {
  assert.equal(cleanCode('7kx2-m9qd'), '7KX2M9QD');
  assert.equal(cleanCode('OIL1'), '0111');
  assert.equal(cleanCode(null), '');
});

test('parseLabelInput: Adresse, Code, Nummer, Unsinn', () => {
  const url = labelUrl('https://st0ptv.github.io/QRate/', '7KX2M9QD');
  assert.equal(url, 'https://st0ptv.github.io/QRate/?k=7KX2M9QD');
  assert.deepEqual(parseLabelInput(url), { code: '7KX2M9QD' });
  assert.deepEqual(parseLabelInput(' 7kx2m9qd '), { code: '7KX2M9QD' });
  assert.deepEqual(parseLabelInput('K-0003'), { kind: 'K', number: 3 });
  assert.deepEqual(parseLabelInput('o 12'), { kind: 'O', number: 12 });
  assert.deepEqual(parseLabelInput('#0042'), { kind: 'Q', number: 42 });
  assert.deepEqual(parseLabelInput('42'), { kind: 'Q', number: 42 });
  assert.deepEqual(parseLabelInput('23456789'), { code: '23456789' });
  assert.equal(parseLabelInput('hallo'), null);
  assert.equal(parseLabelInput(''), null);
  assert.equal(parseLabelInput('https://example.org/'), null);
});

test('inviteUrl ersetzt alte Parameter', () => {
  assert.equal(inviteUrl('https://a.example/app/?k=X#/box', 'ABC'), 'https://a.example/app/?invite=ABC');
});

test('parseQuick: Mengen vorn und hinten', () => {
  assert.deepEqual(parseQuick('3x Christbaumkugeln, Lichterkette, Kabelbinder x20'), [
    { name: 'Christbaumkugeln', qty: 3 },
    { name: 'Lichterkette', qty: 1 },
    { name: 'Kabelbinder', qty: 20 }
  ]);
  assert.deepEqual(parseQuick('2 Isomatten und Gaskocher\nStirnlampen 4x'), [
    { name: 'Isomatten', qty: 2 },
    { name: 'Gaskocher', qty: 1 },
    { name: 'Stirnlampen', qty: 4 }
  ]);
});

test('parseQuick: Zahl im Namen bleibt stehen', () => {
  assert.deepEqual(parseQuick('Wasserwaage 60 cm; HDMI-Kabel 2 m'), [
    { name: 'Wasserwaage 60 cm', qty: 1 },
    { name: 'HDMI-Kabel 2 m', qty: 1 }
  ]);
  assert.deepEqual(parseQuick('Schrauben M4x20'), [{ name: 'Schrauben M4x20', qty: 1 }]);
});

test('parseQuick: leer und Grenzen', () => {
  assert.deepEqual(parseQuick(' , ;\n'), []);
  assert.deepEqual(parseQuick('0x Nichts'), []);
  assert.equal(parseQuick('99999999 Sand')[0].name, '99999999 Sand');
  assert.equal(parseQuick('x'.repeat(200))[0].name.length, 120);
});

test('Kalendereintrag: Datum, Alarm, Sonderzeichen maskiert', () => {
  const ics = reminderIcs({ uid: 'abc', date: '2027-02-16', title: 'Akkuschrauber zurückholen (bei Robin)', description: 'mit 2 Akkus, Ladegerät; Koffer' });
  assert.match(ics, /DTSTART:20270216T090000\r\n/);
  assert.match(ics, /BEGIN:VALARM\r\nACTION:DISPLAY/);
  assert.ok(ics.includes('DESCRIPTION:mit 2 Akkus\\, Ladegerät\\; Koffer'));
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'));
  assert.equal(inDays(90, new Date(2026, 10, 16)), '2027-02-14');
});

// ---------- Kauf und Garantie ----------
import { parsePrice, plusYears, warrantyState, dayText } from '../js/core/warranty.js';

test('Preis lesen: deutsch, englisch, mit Tausenderpunkt, leer, Unsinn', () => {
  assert.equal(parsePrice('249,90'), 249.9);
  assert.equal(parsePrice('1.299,90 €'), 1299.9);
  assert.equal(parsePrice('1299.9'), 1299.9);
  assert.equal(parsePrice('1.299'), 1299);
  assert.equal(parsePrice(' 12 '), 12);
  assert.equal(parsePrice(''), null);
  assert.ok(Number.isNaN(parsePrice('zwölf')));
  assert.ok(Number.isNaN(parsePrice('-5')));
  assert.ok(Number.isNaN(parsePrice('1,999')));
});

test('Garantie: Jahre addieren (auch 29.02.), Zustand', () => {
  assert.equal(plusYears('2025-03-01', 2), '2027-03-01');
  assert.equal(plusYears('2024-02-29', 1), '2025-02-28');
  assert.equal(plusYears('2024-02-29', 4), '2028-02-29');
  assert.equal(warrantyState(null), null);
  assert.equal(warrantyState('2026-01-01', '2026-06-01'), 'over');
  assert.equal(warrantyState('2026-07-01', '2026-06-01'), 'soon');
  assert.equal(warrantyState('2027-01-01', '2026-06-01'), 'ok');
  assert.equal(dayText('2027-03-01'), '01.03.2027');
});

// ---------- ZIP und Inventarliste ----------
import { crc32, makeZip } from '../js/core/zip.js';
import { inventoryCsv, filePaths, backupZip } from '../js/core/backup.js';

test('ZIP: CRC32, Aufbau, Namen in UTF-8', async () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
  const zip = new Uint8Array(await (await makeZip([{ name: 'a.txt', data: 'Hallo' }, { name: 'fotos/ä.jpg', data: new Uint8Array([1, 2, 3]) }])).arrayBuffer());
  const v = new DataView(zip.buffer);
  assert.equal(v.getUint32(0, true), 0x04034B50);
  const end = zip.length - 22;
  assert.equal(v.getUint32(end, true), 0x06054B50);
  assert.equal(v.getUint16(end + 10, true), 2);
  const cd = v.getUint32(end + 16, true);
  assert.equal(v.getUint32(cd, true), 0x02014B50);
  assert.equal(cd, 30 + 5 + 5 + 30 + 'fotos/ä.jpg'.length + 1 + 3); // ä hat 2 Bytes
});

test('Inventarliste: Pfad, Kaufdaten, Formeln entschärft, entnommene fehlen', () => {
  const data = {
    boxes: [{ id: 'r', name: 'Keller', type: 'room', parent_id: null }, { id: 'k', name: 'Kiste 1', type: 'box', parent_id: 'r' },
      { id: 't', name: 'Fernseher', type: 'thing', parent_id: 'r', note: '=HYPERLINK("x")' }],
    items: [{ id: 'i1', box_id: 'k', name: 'Bohrer; groß', qty: 2 }, { id: 'i2', box_id: 'k', name: 'Weg', qty: 1, removed_at: '2026-01-01' }],
    purchases: [{ box_id: 't', bought_on: '2025-03-01', price: 499.9, warranty_until: '2027-03-01', receipt_path: 'h/receipts/a.jpg' },
      { item_id: 'i1', serial: 'SN-1', bought_on: new Date(Date.UTC(2024, 4, 7)) }],
    box_photos: [{ path: 'h/k/1.jpg' }], item_photos: [{ path: 'h/k/items/2.png' }]
  };
  const csv = inventoryCsv(data);
  assert.ok(csv.startsWith('﻿Ort;Ding;Typ;Gegenstand'));
  assert.ok(csv.includes('Keller;Fernseher;Gegenstand;;;"\'=HYPERLINK(""x"")";01.03.2025;499,90;;;01.03.2027;fotos/h/receipts/a.jpg'), csv);
  assert.ok(csv.includes('Keller;Kiste 1;Kiste;"Bohrer; groß";2;;07.05.2024;;;SN-1;;'), csv);
  assert.ok(!csv.includes('Weg'));
  assert.deepEqual(filePaths(data), ['h/k/1.jpg', 'h/k/items/2.png', 'h/receipts/a.jpg']);
});

test('ZIP-Sicherung: fehlende Fotos werden aufgelistet', async () => {
  const data = { boxes: [], items: [], box_photos: [{ path: 'h/k/1.jpg' }, { path: 'h/k/2.jpg' }] };
  const load = async p => { if (p.endsWith('2.jpg')) throw new Error('weg'); return new Blob([new Uint8Array([9])]); };
  const steps = [];
  const r = await backupZip(data, 'Test', load, (i, n) => steps.push(`${i}/${n}`));
  assert.deepEqual([r.photos, r.missing], [1, 1]);
  assert.deepEqual(steps, ['1/2', '2/2']);
  const text = new TextDecoder().decode(new Uint8Array(await r.blob.arrayBuffer()));
  assert.ok(text.includes('fehlende-fotos.txt') && text.includes('fotos/h/k/1.jpg') && text.includes('"schemaVersion": 9'));
});
