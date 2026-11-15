// Prüft, dass Migrationen bestehende Daten richtig übernehmen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDb, createUser, as, migrate } from './helpers/db.js';

test('0005: Orte werden zu Dingen vom Typ Raum, Kisten behalten Inhalt und Ort', async () => {
  const db = await createDb({ upTo: '0005_things.sql' });
  const alex = await createUser(db);
  const house = await as(db, alex, async ({ rpc }) => (await rpc('create_household', { p_name: 'Zuhause', p_display_name: 'Alex' }))[0].create_household);
  const [o] = await as(db, alex, ({ rpc }) => rpc('reserve_labels', { p_household: house, p_kind: 'O', p_count: 1 }));
  const [k] = await as(db, alex, ({ rpc }) => rpc('reserve_labels', { p_household: house, p_kind: 'K', p_count: 1 }));
  const loc = await as(db, alex, async ({ rpc }) => (await rpc('claim_label', { p_code: o.code, p_name: 'Keller' }))[0].claim_label);
  const box = await as(db, alex, async ({ rpc }) => (await rpc('claim_label', { p_code: k.code, p_name: 'Deko', p_location: loc.id }))[0].claim_label);
  await as(db, alex, ({ q }) => q(`insert into public.items (box_id, name) values ($1, 'Kugeln')`, [box.id]));
  const eventsBefore = (await db.query('select count(*)::int as n from public.events')).rows[0].n;

  await migrate(db, '0005_things.sql');

  const resolve = code => as(db, alex, async ({ rpc }) => (await rpc('resolve_label', { p_code: code }))[0].resolve_label);
  const r = await resolve(k.code);
  assert.equal(r.box.type, 'box');
  assert.equal(r.box.parent.id, loc.id);
  assert.deepEqual(r.items.map(i => i.name), ['Kugeln']);
  const rl = await resolve(o.code);
  assert.equal(rl.box.id, loc.id);
  assert.equal(rl.box.type, 'room');
  assert.deepEqual(rl.children.map(c => c.name), ['Deko']);
  assert.equal((await db.query('select count(*)::int as n from public.events')).rows[0].n, eventsBefore, 'kein Verlauf durch die Übernahme');
  await db.close();
});
