import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLabelInput, humanNumber, cleanCode, labelUrl, inviteUrl } from '../js/core/code.js';
import { parseQuick } from '../js/core/parse.js';

test('humanNumber', () => {
  assert.equal(humanNumber('K', 42), 'K-0042');
  assert.equal(humanNumber('O', 7), 'O-007');
  assert.equal(humanNumber('K', null), 'K-????');
});

test('cleanCode: Crockford-Verwechsler', () => {
  assert.equal(cleanCode('7kx2-m9qd'), '7KX2M9QD');
  assert.equal(cleanCode('OIL1'), '0111');
  assert.equal(cleanCode(null), '');
});

test('parseLabelInput: Adresse, Code, Nummer, Unsinn', () => {
  const url = labelUrl('https://st0ptv.github.io/kistenwerk/', '7KX2M9QD');
  assert.equal(url, 'https://st0ptv.github.io/kistenwerk/?k=7KX2M9QD');
  assert.deepEqual(parseLabelInput(url), { code: '7KX2M9QD' });
  assert.deepEqual(parseLabelInput(' 7kx2m9qd '), { code: '7KX2M9QD' });
  assert.deepEqual(parseLabelInput('K-0003'), { kind: 'K', number: 3 });
  assert.deepEqual(parseLabelInput('o 12'), { kind: 'O', number: 12 });
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
