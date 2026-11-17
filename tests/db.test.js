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
  const box = await as(db, alex, async ({ rpc }) => (await rpc('claim_label', { p_code: code, p_name: 'Weihnachtsdeko', p_parent: loc.id }))[0].claim_label);
  assert.equal(box.kind, 'K');

  await as(db, alex, ({ q }) => q(`insert into public.items (box_id, name, qty) values ($1, 'Lichterkette', 2), ($1, 'Christbaumkugeln rot', 12)`, [box.id]));

  const r = await resolve(alex, code);
  assert.equal(r.status, 'box');
  assert.equal(r.box.name, 'Weihnachtsdeko');
  assert.equal(r.box.number, 1);
  assert.equal(r.box.parent.name, 'Keller › Regal 1');
  assert.equal(r.box.type, 'box');
  assert.deepEqual(r.items.map(i => [i.name, i.qty, i.by]), [['Lichterkette', 2, 'Alex'], ['Christbaumkugeln rot', 12, 'Alex']]);

  const rl = await resolve(alex, oLabels[0].code);
  assert.equal(rl.status, 'box');
  assert.equal(rl.box.type, 'room');
  assert.deepEqual(rl.children.map(b => [b.name, b.item_count]), [['Weihnachtsdeko', 2]]);
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
    for (const t of ['households', 'members', 'labels', 'boxes', 'items', 'events']) {
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
  await rejects(as(db, alex, ({ q }) => q('update public.boxes set parent_id = $1 where id = $2', [foreignLoc.id, boxId])), 'Ort gehört nicht');

  const loc2 = await as(db, alex, async ({ rpc }) => (await rpc('claim_label', { p_code: oLabels[1].code, p_name: 'Dachboden' }))[0].claim_label);
  await as(db, robin, ({ q }) => q('update public.boxes set parent_id = $1 where id = $2', [loc2.id, boxId]));
  assert.equal((await resolve(alex, kLabels[0].code)).box.parent.name, 'Dachboden');
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

test('Fotos: Mitglied lädt hoch, Fremder sieht und schreibt nichts, höchstens 8 pro Kiste', async () => {
  const [label] = await as(db, alex, ({ rpc }) => rpc('reserve_labels', { p_household: house, p_kind: 'K', p_count: 1 }));
  const box = await as(db, alex, async ({ rpc }) => (await rpc('claim_label', { p_code: label.code, p_name: 'Fotokiste' }))[0].claim_label);
  const path = n => `${house}/${box.id}/${n}.jpg`;
  const upload = (user, p) => as(db, user, ({ q }) => q(`insert into storage.objects (bucket_id, name) values ('box-photos', $1)`, [p]));
  const addRow = (user, p) => as(db, user, ({ q }) => q('insert into public.box_photos (box_id, path) values ($1, $2) returning household_id, created_by', [box.id, p]));

  await upload(alex, path(1));
  const [row] = await addRow(alex, path(1));
  assert.equal(row.household_id, house);
  assert.equal(row.created_by, alex);

  // Fremder: keine Zeilen, keine Dateien, kein Hochladen in fremde Ordner
  assert.equal((await as(db, fremd, ({ q }) => q('select * from public.box_photos'))).length, 0);
  assert.equal((await as(db, fremd, ({ q }) => q(`select * from storage.objects where bucket_id = 'box-photos'`))).length, 0);
  await rejects(upload(fremd, path('fremd')), 'row-level security');
  await rejects(addRow(fremd, path('fremd')), 'row-level security');
  assert.equal((await as(db, fremd, ({ q }) => q(`delete from storage.objects where name = $1 returning id`, [path(1)]))).length, 0);

  // Pfad muss zur Kiste passen
  await rejects(addRow(alex, `${house}/anders/1.jpg`), 'Foto-Pfad');

  // Nicht angemeldet: Tabelle gar nicht erreichbar
  await rejects(as(db, null, ({ q }) => q('select * from public.box_photos')), 'permission denied');

  for (let n = 2; n <= 8; n++) await addRow(alex, path(n));
  await rejects(addRow(alex, path(9)), 'photo_limit');

  // Mitglied darf löschen
  assert.equal((await as(db, alex, ({ q }) => q('delete from public.box_photos where path = $1 returning id', [path(8)]))).length, 1);
});

test('Gegenstandsfoto: eins pro Gegenstand, Fremder sieht und schreibt nichts', async () => {
  const [label] = await as(db, alex, ({ rpc }) => rpc('reserve_labels', { p_household: house, p_kind: 'K', p_count: 1 }));
  const box = await as(db, alex, async ({ rpc }) => (await rpc('claim_label', { p_code: label.code, p_name: 'Taschen' }))[0].claim_label);
  const [item] = await as(db, alex, ({ q }) => q(`insert into public.items (box_id, name) values ($1, 'Reisetasche') returning id`, [box.id]));
  const path = n => `${house}/${box.id}/items/${n}.png`;
  const upload = (user, p) => as(db, user, ({ q }) => q(`insert into storage.objects (bucket_id, name) values ('box-photos', $1)`, [p]));
  const addRow = (user, p, itemId = item.id) =>
    as(db, user, ({ q }) => q('insert into public.item_photos (item_id, path) values ($1, $2) returning household_id, box_id, created_by, cutout', [itemId, p]));

  await upload(alex, path(1));
  const [row] = await addRow(alex, path(1));
  assert.equal(row.household_id, house);
  assert.equal(row.box_id, box.id);
  assert.equal(row.created_by, alex);
  assert.equal(row.cutout, true);

  // Nur ein Foto pro Gegenstand
  await rejects(addRow(alex, path(2)), 'duplicate key');

  // Pfad muss unter <haushalt>/<kiste>/items/ liegen
  const [other] = await as(db, alex, ({ q }) => q(`insert into public.items (box_id, name) values ($1, 'Rucksack') returning id`, [box.id]));
  await rejects(addRow(alex, `${house}/${box.id}/3.png`, other.id), 'Foto-Pfad');

  // Fremder: keine Zeilen, kein Eintrag für fremde Gegenstände, kein Löschen
  assert.equal((await as(db, fremd, ({ q }) => q('select * from public.item_photos'))).length, 0);
  await rejects(addRow(fremd, path('fremd'), other.id), 'row-level security');
  assert.equal((await as(db, fremd, ({ q }) => q('delete from public.item_photos returning id'))).length, 0);

  // Nicht angemeldet: Tabelle gar nicht erreichbar
  await rejects(as(db, null, ({ q }) => q('select * from public.item_photos')), 'permission denied');

  // Bucket nimmt jetzt auch PNG
  const [bucket] = (await db.query(`select allowed_mime_types from storage.buckets where id = 'box-photos'`)).rows;
  assert.deepEqual(bucket.allowed_mime_types, ['image/jpeg', 'image/png']);

  // Mitglied ersetzt: altes löschen, neues eintragen
  assert.equal((await as(db, robin, ({ q }) => q('delete from public.item_photos where item_id = $1 returning id', [item.id]))).length, 1);
  await addRow(robin, path(2));
});

test('Neutrale Etiketten: Typ beim ersten Scan, verschachteln, Pfad', async () => {
  const q4 = await as(db, alex, ({ rpc }) => rpc('reserve_labels', { p_household: house, p_kind: 'Q', p_count: 4 }));
  assert.deepEqual(q4.map(l => l.kind + l.number), ['Q1', 'Q2', 'Q3', 'Q4']);
  const claim = (l, name, type, parent) => as(db, alex, async ({ rpc }) =>
    (await rpc('claim_label', { p_code: l.code, p_name: name, p_type: type, p_parent: parent ?? null }))[0].claim_label);

  // Ohne Typ geht ein neutrales Etikett nicht
  await rejects(claim(q4[0], 'Keller'), 'bad_request');
  const keller = await claim(q4[0], 'Keller', 'room');
  const regal = await claim(q4[1], 'Lastenregal', 'rack', keller.id);
  const ebene = await claim(q4[2], 'Ebene oben', 'shelf', regal.id);
  const kiste = await claim(q4[3], 'Werkzeug Elektro', 'box', ebene.id);
  assert.equal(kiste.type, 'box');

  const r = await resolve(alex, q4[3].code);
  assert.deepEqual(r.box.path.map(p => p.name), ['Keller', 'Lastenregal', 'Ebene oben']);
  assert.equal((await resolve(alex, q4[1].code)).children[0].name, 'Ebene oben');

  // Kein Kreis: das Regal darf nicht in seine eigene Ebene
  await rejects(as(db, alex, ({ q }) => q('update public.boxes set parent_id = $1 where id = $2', [ebene.id, regal.id])), 'cycle');

  // Suche zeigt den Pfad
  await as(db, alex, ({ q }) => q(`insert into public.items (box_id, name) values ($1, 'Akkuschrauber')`, [kiste.id]));
  const hit = (await as(db, alex, ({ rpc }) => rpc('search', { p_household: house, p_q: 'akkuschrauber' })))[0];
  assert.equal(hit.location_name, 'Keller › Lastenregal › Ebene oben');

  // Fremder sieht das Ding nicht
  assert.equal((await as(db, fremd, ({ rpc }) => rpc('get_thing', { p_id: kiste.id })))[0].get_thing, null);
});

test('Typ ändern: Inhalt wandert eine Ebene höher, Einzelstück nimmt nichts auf', async () => {
  const [a, b] = await as(db, alex, ({ rpc }) => rpc('reserve_labels', { p_household: house, p_kind: 'Q', p_count: 2 }));
  const claim = (l, name, type, parent) => as(db, alex, async ({ rpc }) =>
    (await rpc('claim_label', { p_code: l.code, p_name: name, p_type: type, p_parent: parent ?? null }))[0].claim_label);
  const schrank = await claim(a, 'Werkzeugschrank', 'cabinet');
  const koffer = await claim(b, 'Werkzeugkoffer rot', 'box', schrank.id);
  await as(db, alex, ({ q }) => q(`insert into public.items (box_id, name) values ($1, 'Bits'), ($1, 'Zange')`, [koffer.id]));
  const retype = (id, type, user = alex) => as(db, user, ({ rpc }) => rpc('change_type', { p_id: id, p_type: type }));

  await rejects(retype(koffer.id, 'rakete'), 'bad_request');
  await rejects(retype(koffer.id, 'tool', fremd), 'no_access');
  await retype(koffer.id, 'tool');
  const left = await as(db, alex, ({ q }) => q('select count(*)::int as n from public.items where box_id = $1', [koffer.id]));
  assert.equal(left[0].n, 0);
  const moved = await as(db, alex, ({ q }) => q('select name from public.items where box_id = $1 order by name', [schrank.id]));
  assert.deepEqual(moved.map(m => m.name), ['Bits', 'Zange']);

  // In ein Einzelstück kann nichts hinein
  await rejects(as(db, alex, ({ q }) => q(`update public.items set box_id = $1 where name = 'Bits'`, [koffer.id])), 'single');
  const ev = await as(db, alex, ({ q }) => q(`select action from public.events where box_id = $1 order by at desc limit 1`, [koffer.id]));
  assert.equal(ev[0].action, 'box_retyped');

  // Ohne übergeordneten Ort kann ein voller Schrank kein Einzelstück werden
  await rejects(retype(schrank.id, 'furniture'), 'type_needs_parent');
});

test('Ausleihen: Person, Erinnerung, einmal gleichzeitig, Fremder sieht nichts', async () => {
  const [a, b] = await as(db, alex, ({ rpc }) => rpc('reserve_labels', { p_household: house, p_kind: 'Q', p_count: 2 }));
  const claim = (l, name, type) => as(db, alex, async ({ rpc }) =>
    (await rpc('claim_label', { p_code: l.code, p_name: name, p_type: type }))[0].claim_label);
  const bohrer = await claim(a, 'Akkuschrauber', 'tool');
  const garage = await claim(b, 'Garage', 'room');
  const [jonas] = await as(db, alex, ({ q }) => q(`insert into public.borrowers (household_id, name, phone) values ($1, 'Jonas', 'Test-Nummer') returning id`, [house]));
  const lend = (user, boxId, borrower = jonas.id) => as(db, user, ({ q }) =>
    q(`insert into public.lendings (box_id, borrower_id, remind_at, note) values ($1, $2, current_date + 90, 'mit 2 Akkus') returning household_id, created_by, lent_at`, [boxId, borrower]));

  const [row] = await lend(robin, bohrer.id);
  assert.equal(row.household_id, house);
  assert.equal(row.created_by, robin);

  // Nur einmal gleichzeitig, Orte gar nicht
  await rejects(lend(alex, bohrer.id), 'duplicate key');
  await rejects(lend(alex, garage.id), 'not_lendable');

  // Verlauf nennt die Person
  const ev = await as(db, alex, ({ q }) => q(`select action, detail from public.events where box_id = $1 order by at desc limit 1`, [bohrer.id]));
  assert.deepEqual([ev[0].action, ev[0].detail.to], ['lent', 'Jonas']);

  // Fremder: keine Personen, keine Ausleihen, keine fremde Person verwenden, nichts zurückbuchen
  assert.equal((await as(db, fremd, ({ q }) => q('select * from public.borrowers'))).length, 0);
  assert.equal((await as(db, fremd, ({ q }) => q('select * from public.lendings'))).length, 0);
  assert.equal((await as(db, fremd, ({ q }) => q('update public.lendings set returned_at = now() returning id'))).length, 0);
  await rejects(as(db, fremd, ({ q }) => q(`insert into public.borrowers (household_id, name) values ($1, 'X')`, [house])), 'row-level security');
  await rejects(as(db, null, ({ q }) => q('select * from public.borrowers')), 'permission denied');

  // Zurück erhalten, danach wieder verleihbar
  await as(db, alex, ({ q }) => q('update public.lendings set returned_at = now() where box_id = $1 and returned_at is null', [bohrer.id]));
  const back = await as(db, alex, ({ q }) => q(`select action, detail from public.events where box_id = $1 order by at desc limit 1`, [bohrer.id]));
  assert.deepEqual([back[0].action, back[0].detail.from], ['returned', 'Jonas']);
  await lend(alex, bohrer.id);

  // Zurückgegeben bleibt zurückgegeben: nicht wieder öffnen, nicht umdatieren; Rückgabezeit vom Server
  await rejects(as(db, alex, ({ q }) => q('update public.lendings set returned_at = null where box_id = $1 and returned_at is not null', [bohrer.id])), 'already_returned');
  await rejects(as(db, alex, ({ q }) => q(`update public.lendings set returned_at = now() - interval '9 days' where box_id = $1 and returned_at is not null`, [bohrer.id])), 'already_returned');

  // Ein Eintrag wie vor 0007 (ohne Personen-ID) muss beim Löschen ebenfalls seinen Namen verlieren
  await db.query(`update public.events set detail = detail - 'borrower' where box_id = $1 and action = 'lent'`, [bohrer.id]);
  // Andere Person mit Ausleihe: ihr Name bleibt
  const [mia] = await as(db, alex, ({ q }) => q(`insert into public.borrowers (household_id, name) values ($1, 'Mia') returning id`, [house]));
  await as(db, alex, ({ q }) => q('update public.lendings set returned_at = now() where box_id = $1 and returned_at is null', [bohrer.id]));
  await lend(alex, bohrer.id, mia.id);

  // Fremder kann die Person nicht löschen, Namen bleiben
  assert.equal((await as(db, fremd, ({ q }) => q('delete from public.borrowers where id = $1 returning id', [jonas.id]))).length, 0);

  // Person löschen: Verlauf bleibt, ohne Namen
  await as(db, alex, ({ q }) => q('delete from public.borrowers where id = $1', [jonas.id]));
  const hist = await as(db, alex, ({ q }) => q('select borrower_id from public.lendings where box_id = $1 order by lent_at', [bohrer.id]));
  assert.equal(hist.length, 3);
  assert.ok(hist.slice(0, 2).every(h => h.borrower_id === null));
  const evs = await as(db, alex, ({ q }) => q(`select action, detail from public.events where box_id = $1 and action in ('lent', 'returned')`, [bohrer.id]));
  assert.ok(evs.length >= 5);
  assert.ok(!JSON.stringify(evs).includes('Jonas'), 'Name der gelöschten Person steht nicht mehr im Verlauf');
  assert.ok(JSON.stringify(evs).includes('Mia'), 'Andere Personen bleiben im Verlauf');
});

test('Speichergrenzen: pro Haushalt und für den ganzen Bucket, Fremde erfahren nichts', async () => {
  const MB = 1024 * 1024;
  const hh = await as(db, robin, async ({ rpc }) => (await rpc('create_household', { p_name: 'Werkstatt', p_display_name: 'Robin' }))[0].create_household);
  const usage = user => as(db, user, async ({ rpc }) => (await rpc('household_storage', { p_household: hh }))[0]);
  const upload = (user, name, size) => as(db, user, ({ q }) =>
    q(`insert into storage.objects (bucket_id, name, metadata) values ('box-photos', $1, $2)`, [name, size == null ? null : { size }]));
  // Daten anderer Haushalte direkt eintragen (wie durch frühere Uploads)
  const fill = (name, size) => db.query(`insert into storage.objects (bucket_id, name, metadata) values ('box-photos', $1, $2)`, [name, { size }]);

  assert.deepEqual({ ...(await usage(robin)) }, { used_bytes: 0, files: 0, limit_bytes: 250 * MB, limit_files: 1000 });
  await upload(robin, `${hh}/k/1.jpg`, 400000);
  // Ohne Größe (Hochladen läuft noch) zählt die größte erlaubte Datei
  await upload(robin, `${hh}/k/2.jpg`, null);
  assert.deepEqual({ ...(await usage(robin)) }, { used_bytes: 400000 + 3 * MB, files: 2, limit_bytes: 250 * MB, limit_files: 1000 });

  // Fremder: kein Verbrauch, kein Hochladen
  await rejects(usage(fremd), 'no_access');
  await rejects(as(db, null, ({ rpc }) => rpc('household_storage', { p_household: hh })), 'permission denied');

  // Haushalt voll: Mitglied bekommt eine klare Meldung, Fremder nur die übliche Ablehnung
  await fill(`${hh}/k/gross.jpg`, 250 * MB);
  await rejects(upload(robin, `${hh}/k/3.jpg`, 1000), 'storage_limit');
  await rejects(upload(fremd, `${hh}/k/3.jpg`, 1000), 'row-level security');
  await db.query(`delete from storage.objects where name = $1`, [`${hh}/k/gross.jpg`]);
  await upload(robin, `${hh}/k/3.jpg`, 1000);

  // Bucket insgesamt fast voll (andere Haushalte): niemand lädt mehr hoch
  const before = (await db.query(`select coalesce(sum((metadata->>'size')::bigint), 0)::bigint as s from storage.objects`)).rows[0].s;
  await fill('anderer-haushalt/k/a.jpg', 800 * MB - Number(before));
  await rejects(upload(robin, `${hh}/k/4.jpg`, 1000), 'storage_full');
  await db.query(`delete from storage.objects where name like 'anderer-haushalt/%'`);
  await upload(robin, `${hh}/k/4.jpg`, 1000);
});

test('Prüfen: Zeit und Person vom Server, Verlauf höchstens stündlich, Fremder darf nicht', async () => {
  const [label] = await as(db, alex, ({ rpc }) => rpc('reserve_labels', { p_household: house, p_kind: 'K', p_count: 1 }));
  const box = await as(db, alex, async ({ rpc }) => (await rpc('claim_label', { p_code: label.code, p_name: 'Prüfkiste' }))[0].claim_label);
  await as(db, alex, ({ q }) => q(`insert into public.items (box_id, name, qty) values ($1, 'Schrauben', 3)`, [box.id]));
  const check = user => as(db, user, ({ rpc }) => rpc('check_thing', { p_id: box.id }));
  const thing = async user => (await as(db, user, ({ rpc }) => rpc('get_thing', { p_id: box.id })))[0].get_thing;

  assert.equal((await thing(alex)).box.checked_at, null);
  await check(robin);
  const b = (await thing(alex)).box;
  assert.ok(b.checked_at);
  assert.equal(b.checked_by_name, 'Robin');
  await check(alex); // gleich danach: kein zweiter Verlaufseintrag
  const ev = await as(db, alex, ({ q }) => q(`select detail from public.events where box_id = $1 and action = 'box_checked'`, [box.id]));
  assert.equal(ev.length, 1);
  assert.equal(ev[0].detail.items, 1);
  assert.equal((await thing(alex)).box.checked_by_name, 'Alex');

  // Fremder und nicht angemeldet: kein Prüfen, Spalten nicht direkt beschreibbar
  await rejects(check(fremd), 'no_access');
  await rejects(as(db, null, ({ rpc }) => rpc('check_thing', { p_id: box.id })), 'permission denied');
  await rejects(as(db, alex, ({ q }) => q(`update public.boxes set checked_at = now() - interval '1 year' where id = $1`, [box.id])), 'permission denied');
});

test('Kauf und Garantie: für Ding oder Gegenstand, Beleg im eigenen Ordner, Fremder sieht nichts', async () => {
  const [label] = await as(db, alex, ({ rpc }) => rpc('reserve_labels', { p_household: house, p_kind: 'Q', p_count: 1 }));
  const tv = await as(db, alex, async ({ rpc }) => (await rpc('claim_label', { p_code: label.code, p_name: 'Fernseher', p_type: 'thing' }))[0].claim_label);
  const [kl] = await as(db, alex, ({ rpc }) => rpc('reserve_labels', { p_household: house, p_kind: 'K', p_count: 1 }));
  const kiste = await as(db, alex, async ({ rpc }) => (await rpc('claim_label', { p_code: kl.code, p_name: 'Werkzeug' }))[0].claim_label);
  const [bohrer] = await as(db, alex, ({ q }) => q(`insert into public.items (box_id, name) values ($1, 'Bohrmaschine') returning id`, [kiste.id]));
  const buy = (user, cols) => {
    const keys = Object.keys(cols);
    return as(db, user, ({ q }) => q(`insert into public.purchases (${keys.join(', ')}) values (${keys.map((_, i) => '$' + (i + 1)).join(', ')})
      returning household_id, created_by, price::text`, keys.map(k => cols[k])));
  };

  const [p] = await buy(alex, { box_id: tv.id, bought_on: '2025-03-01', price: '499.90', warranty_until: '2027-03-01', receipt_path: `${house}/receipts/a.jpg` });
  assert.deepEqual([p.household_id, p.created_by, p.price], [house, alex, '499.90']);
  await buy(robin, { item_id: bohrer.id, serial: 'SN-1' });

  // Nur ein Kauf pro Ding oder Gegenstand, genau eins von beiden
  await rejects(buy(alex, { box_id: tv.id }), 'duplicate key');
  await rejects(buy(alex, { box_id: kiste.id, item_id: bohrer.id }), 'purchases_one_target');
  await rejects(buy(alex, { box_id: null, item_id: null }), 'row-level security'); // ohne Ziel kein Haushalt
  // Beleg nur unter <haushalt>/receipts/
  await rejects(buy(alex, { box_id: kiste.id, receipt_path: 'anderer/receipts/x.jpg' }), 'Beleg-Pfad');
  await rejects(as(db, alex, ({ q }) => q(`update public.purchases set receipt_path = $2 where box_id = $1`, [tv.id, `${house}/x.jpg`])), 'Beleg-Pfad');
  // Negativer Preis nicht
  await rejects(buy(alex, { box_id: kiste.id, price: '-1' }), 'check constraint');
  // Ziel nicht umhängen
  await rejects(as(db, alex, ({ q }) => q(`update public.purchases set box_id = $2 where box_id = $1`, [tv.id, kiste.id])), 'permission denied');

  // Mitglied ändert
  const [u] = await as(db, robin, ({ q }) => q(`update public.purchases set shop = 'Markt' where box_id = $1 returning shop`, [tv.id]));
  assert.equal(u.shop, 'Markt');

  // Fremder: sieht nichts, legt nichts an, ändert und löscht nichts
  assert.equal((await as(db, fremd, ({ q }) => q('select * from public.purchases'))).length, 0);
  await rejects(buy(fremd, { box_id: kiste.id }), 'row-level security');
  assert.equal((await as(db, fremd, ({ q }) => q(`update public.purchases set shop = 'x' returning id`))).length, 0);
  assert.equal((await as(db, fremd, ({ q }) => q('delete from public.purchases returning id'))).length, 0);
  await rejects(as(db, null, ({ q }) => q('select * from public.purchases')), 'permission denied');

  // Gegenstand zieht um: Kauf bleibt dran; Ding gelöscht: Kauf weg
  const [kl2] = await as(db, alex, ({ rpc }) => rpc('reserve_labels', { p_household: house, p_kind: 'K', p_count: 1 }));
  const kiste2 = await as(db, alex, async ({ rpc }) => (await rpc('claim_label', { p_code: kl2.code, p_name: 'Keller' }))[0].claim_label);
  await as(db, alex, ({ q }) => q('update public.items set box_id = $2 where id = $1', [bohrer.id, kiste2.id]));
  assert.equal((await as(db, alex, ({ q }) => q('select serial from public.purchases where item_id = $1', [bohrer.id])))[0].serial, 'SN-1');
  await as(db, alex, ({ q }) => q('delete from public.boxes where id = $1', [tv.id]));
  assert.equal((await as(db, alex, ({ q }) => q('select * from public.purchases where box_id = $1', [tv.id]))).length, 0);
});
