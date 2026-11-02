import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDb, createUser, as, rejects } from './helpers/db.js';

let db, alex, robin, fremd, house, kLabels, oLabels;

before(async () => {
  db = await createDb();
  [alex, robin, fremd] = [await createUser(db), await createUser(db), await createUser(db)];
  house = await as(db, alex, async ({ rpc }) => (await rpc('create_household', { p_name: 'Zuhause', p_display_name: 'Alex' }))[0].create_household);
  kLabels = await as(db, alex, ({ rpc }) => rpc('reserve_labels', { p_household: house, p_kind: 'K', p_count: 5 }));
  oLabels = await as(db, alex, ({ rpc }) => rpc('reserve_labels', { p_household: house, p_kind: 'O', p_count: 2 }));
});

after(() => db.close());

const resolve = (user, code) => as(db, user, async ({ rpc }) => (await rpc('resolve_label', { p_code: code }))[0].resolve_label);

test('Etiketten: Crockford-Code, fortlaufende Nummern, frei', () => {
  assert.equal(kLabels.length, 5);
  assert.deepEqual(kLabels.map(l => l.number), [1, 2, 3, 4, 5]);
  for (const l of [...kLabels, ...oLabels]) {
    assert.match(l.code, /^[0-9A-HJKMNP-TV-Z]{8}$/);
    assert.equal(l.status, 'free');
  }
  assert.equal(new Set(kLabels.map(l => l.code)).size, 5);
});

test('Weitere Etiketten setzen die Nummer fort', async () => {
  const more = await as(db, alex, ({ rpc }) => rpc('reserve_labels', { p_household: house, p_kind: 'K', p_count: 2 }));
  assert.deepEqual(more.map(l => l.number), [6, 7]);
});

test('Freies Etikett scannen, anlegen, Inhalt erfassen, scannen', async () => {
  const code = kLabels[0].code;
  assert.equal((await resolve(alex, code)).status, 'free');

  const loc = await as(db, alex, async ({ rpc }) => (await rpc('claim_label', { p_code: oLabels[0].code, p_name: 'Keller › Regal 1' }))[0].claim_label);
  const box = await as(db, alex, async ({ rpc }) => (await rpc('claim_label', { p_code: code, p_name: 'Weihnachtsdeko', p_location: loc.id }))[0].claim_label);
  assert.equal(box.kind, 'K');

  await as(db, alex, ({ q }) => q(`insert into public.items (box_id, name, qty) values ($1, 'Lichterkette', 2), ($1, 'Christbaumkugeln rot', 12)`, [box.id]));

  const r = await resolve(alex, code);
  assert.equal(r.status, 'box');
  assert.equal(r.box.name, 'Weihnachtsdeko');
  assert.equal(r.box.number, 1);
  assert.equal(r.box.location.name, 'Keller › Regal 1');
  assert.deepEqual(r.items.map(i => [i.name, i.qty, i.by]), [['Lichterkette', 2, 'Alex'], ['Christbaumkugeln rot', 12, 'Alex']]);

  const rl = await resolve(alex, oLabels[0].code);
  assert.equal(rl.status, 'location');
  assert.deepEqual(rl.boxes.map(b => [b.number, b.item_count]), [[1, 2]]);
});

test('Ein belegtes Etikett lässt sich nicht erneut zuordnen', async () => {
  await rejects(as(db, alex, ({ rpc }) => rpc('claim_label', { p_code: kLabels[0].code, p_name: 'Doppelt' })), 'label_taken');
});

test('Fremder: unbekannter und fremder Code sehen gleich aus', async () => {
  const foreign = await resolve(fremd, kLabels[0].code);
  const unknown = await resolve(fremd, 'ZZZZZZZZ');
  assert.deepEqual(foreign, { status: 'denied' });
  assert.deepEqual(unknown, { status: 'denied' });
});

test('Fremder: sieht keine Zeilen und kann nichts schreiben', async () => {
  await as(db, fremd, async ({ q, rpc }) => {
    for (const t of ['households', 'members', 'labels', 'locations', 'boxes', 'items', 'events']) {
      assert.equal((await q(`select count(*)::int as n from public.${t}`))[0].n, 0, t);
    }
    const boxId = (await db.query('select id from public.boxes limit 1')).rows[0]?.id;
    await rejects(q(`insert into public.items (box_id, name) values ($1, 'Eingeschmuggelt')`, [boxId]));
    await rejects(rpc('claim_label', { p_code: kLabels[1].code, p_name: 'Fremd' }), 'no_access');
    await rejects(rpc('reserve_labels', { p_household: house, p_kind: 'K', p_count: 1 }), 'no_access');
    const upd = await q(`update public.boxes set name = 'Gekapert' returning id`);
    assert.equal(upd.length, 0);
  });
});

test('Nicht angemeldet: weder Scan-Funktion noch Tabellen erreichbar', async () => {
  await rejects(resolve(null, kLabels[0].code), 'permission denied');
  await rejects(as(db, null, ({ q }) => q('select * from public.items')), 'permission denied');
});

test('Einladung: wartend sieht nichts, nach Bestätigung alles', async () => {
  const inv = await as(db, alex, async ({ rpc }) => (await rpc('create_invite', { p_household: house }))[0].create_invite);
  assert.match(inv.token, /^[0-9A-HJKMNP-TV-Z]{16}$/);
  await as(db, robin, ({ rpc }) => rpc('accept_invite', { p_token: inv.token.toLowerCase(), p_display_name: 'Robin' }));
  await rejects(as(db, fremd, ({ rpc }) => rpc('accept_invite', { p_token: inv.token, p_display_name: 'X' })), 'invite_invalid');

  assert.deepEqual(await resolve(robin, kLabels[0].code), { status: 'denied' });
  const own = await as(db, robin, ({ q }) => q('select status from public.members'));
  assert.deepEqual(own, [{ status: 'pending' }]);

  const robinMember = (await db.query('select id from public.members where user_id = $1', [robin])).rows[0].id;
  await rejects(as(db, robin, ({ rpc }) => rpc('set_member_status', { p_member: robinMember, p_action: 'approve' })), 'admin_only');
  await as(db, alex, ({ rpc }) => rpc('set_member_status', { p_member: robinMember, p_action: 'approve' }));
  assert.equal((await resolve(robin, kLabels[0].code)).status, 'box');
});

test('Ersteller kommt aus der Anmeldung, nicht aus der Anfrage', async () => {
  const boxId = (await resolve(alex, kLabels[0].code)).box.id;
  await as(db, robin, ({ q }) => q(`insert into public.items (box_id, name) values ($1, 'Baumspitze')`, [boxId]));
  const r = await resolve(alex, kLabels[0].code);
  assert.equal(r.items.at(-1).by, 'Robin');
  await rejects(as(db, robin, ({ q }) => q(`insert into public.items (box_id, name, created_by) values ($1, 'Fake', $2)`, [boxId, alex])));
});

test('Entnehmen und Zurücklegen landen im Verlauf', async () => {
  const boxId = (await resolve(alex, kLabels[0].code)).box.id;
  await as(db, robin, ({ q }) => q(`update public.items set removed_at = now() where box_id = $1 and name = 'Lichterkette'`, [boxId]));
  let r = await resolve(alex, kLabels[0].code);
  assert.ok(!r.items.some(i => i.name === 'Lichterkette'));
  const ev = await as(db, alex, ({ q }) => q(`select action, actor_id from public.events where box_id = $1 order by at`, [boxId]));
  assert.deepEqual(ev.at(-1), { action: 'item_removed', actor_id: robin });
  await as(db, alex, ({ q }) => q(`update public.items set removed_at = null where box_id = $1 and name = 'Lichterkette'`, [boxId]));
  r = await resolve(alex, kLabels[0].code);
  assert.ok(r.items.some(i => i.name === 'Lichterkette'));
});

test('Verschieben: nur an Orte des eigenen Haushalts', async () => {
  const boxId = (await resolve(alex, kLabels[0].code)).box.id;
  const other = await as(db, fremd, async ({ rpc }) => (await rpc('create_household', { p_name: 'Anderer', p_display_name: 'F' }))[0].create_household);
  const [ol] = await as(db, fremd, ({ rpc }) => rpc('reserve_labels', { p_household: other, p_kind: 'O', p_count: 1 }));
  const foreignLoc = await as(db, fremd, async ({ rpc }) => (await rpc('claim_label', { p_code: ol.code, p_name: 'Fremdkeller' }))[0].claim_label);
  await rejects(as(db, alex, ({ q }) => q('update public.boxes set location_id = $1 where id = $2', [foreignLoc.id, boxId])), 'Ort gehört nicht');

  const loc2 = await as(db, alex, async ({ rpc }) => (await rpc('claim_label', { p_code: oLabels[1].code, p_name: 'Dachboden' }))[0].claim_label);
  await as(db, robin, ({ q }) => q('update public.boxes set location_id = $1 where id = $2', [loc2.id, boxId]));
  assert.equal((await resolve(alex, kLabels[0].code)).box.location.name, 'Dachboden');
});

test('Suche: Teilwort und Tippfehler', async () => {
  const code = kLabels[1].code;
  const box = await as(db, alex, async ({ rpc }) => (await rpc('claim_label', { p_code: code, p_name: 'Camping' }))[0].claim_label);
  await as(db, alex, ({ q }) => q(`insert into public.items (box_id, name, qty) values ($1, 'Stirnlampen', 3), ($1, 'HDMI-Adapter USB-C', 1)`, [box.id]));
  const search = (term, user = alex) => as(db, user, ({ rpc }) => rpc('search', { p_household: house, p_q: term }));

  assert.equal((await search('hdmi'))[0].item_name, 'HDMI-Adapter USB-C');
  assert.equal((await search('stirnlampe'))[0].item_name, 'Stirnlampen');
  assert.equal((await search('lichterkete'))[0].item_name, 'Lichterkette');
  assert.equal((await search('camping'))[0].kind, 'box');
  assert.equal((await search('hdmi', fremd)).length, 0);
});

test('Etikett sperren: Scan verweigert, Kiste bleibt', async () => {
  const code = kLabels[1].code;
  const boxId = (await resolve(alex, code)).box.id;
  await rejects(as(db, robin, ({ rpc }) => rpc('block_label', { p_code: code })), 'admin_only');
  await as(db, alex, ({ rpc }) => rpc('block_label', { p_code: code }));
  assert.deepEqual(await resolve(alex, code), { status: 'denied' });
  const left = await as(db, alex, ({ q }) => q('select name, label_code from public.boxes where id = $1', [boxId]));
  assert.deepEqual(left, [{ name: 'Camping', label_code: null }]);
});

test('Der letzte Admin kann nicht entfernt werden', async () => {
  const alexMember = (await db.query('select id from public.members where user_id = $1 and household_id = $2', [alex, house])).rows[0].id;
  await rejects(as(db, alex, ({ rpc }) => rpc('set_member_status', { p_member: alexMember, p_action: 'remove' })), 'last_admin');
});
