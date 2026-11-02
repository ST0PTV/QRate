// Testumgebung: ersetzt js/core/api.js (per Import-Map) durch dieselben Funktionen auf PGlite im Browser.
// Gleiche Migrationen, gleiche Row-Level-Security – nur die Übersetzung der Supabase-Abfragen ist hier nachgebaut.
// Nutzer wählen: ?as=alex | robin | neu | fremd  (wird in sessionStorage gemerkt)
import { PGlite } from '/node_modules/@electric-sql/pglite/dist/index.js';
import { pg_trgm } from '/node_modules/@electric-sql/pglite/dist/contrib/pg_trgm.js';
import { AUTH_STUB, AUTH_GRANTS, MIGRATIONS } from '/tests/helpers/auth-stub.js';
export { errorText } from '/js/core/errors.js';

const USERS = {
  alex: { id: '11111111-1111-4111-8111-111111111111', email: 'alex@example.org' },
  robin: { id: '22222222-2222-4222-8222-222222222222', email: 'robin@example.org' },
  neu: { id: '33333333-3333-4333-8333-333333333333', email: 'neu@example.org' },
  fremd: { id: '44444444-4444-4444-8444-444444444444', email: 'fremd@example.org' }
};

// window.location: "location" ist unten eine exportierte Funktion
const param = new URL(window.location.href).searchParams.get('as');
if (param) sessionStorage.setItem('qr_mock_user', param);
let current = sessionStorage.getItem('qr_mock_user') ?? 'alex';
if (current === 'none') current = null;
const authListeners = [];

// Die Datenbank liegt in IndexedDB: Neuladen und Nutzerwechsel sehen denselben Stand (wie bei einem echten Server).
// ?reset=1 legt sie neu an.
let db;
export const ready = (async () => {
  const reset = new URL(window.location.href).searchParams.has('reset');
  if (reset) await new Promise(ok => { const r = indexedDB.deleteDatabase('/pglite/qr-mock'); r.onsuccess = r.onerror = r.onblocked = ok; });
  db = new PGlite('idb://qr-mock', { extensions: { pg_trgm } });
  const exists = (await db.query(`select to_regclass('public.boxes') as t`)).rows[0].t;
  if (!exists) {
    await db.exec(AUTH_STUB);
    for (const f of MIGRATIONS) await db.exec(await (await fetch('/supabase/migrations/' + f)).text());
    await db.exec(AUTH_GRANTS);
    for (const u of Object.values(USERS)) await db.query('insert into auth.users (id, email) values ($1, $2)', [u.id, u.email]);
    await seed();
  }
  window.__mockCodes = {
    k: (await db.query(`select code from public.labels where kind = 'K' and household_id = (select id from public.households order by created_at limit 1) order by number`)).rows.map(r => r.code),
    o: (await db.query(`select code from public.labels where kind = 'O' and household_id = (select id from public.households order by created_at limit 1) order by number`)).rows.map(r => r.code)
  };
  window.__mockReady = true;
})();
ready.catch(e => { window.__mockError = String(e?.stack ?? e); console.error('Testumgebung:', e); });

// Jede Abfrage in einer eigenen Transaktion mit "set local role": parallele Aufrufe können sich nicht mischen.
// seed() ruft as() noch während "ready" läuft, deshalb wartet erst q()/one() auf ready.
async function as(userKey, fn) {
  const u = userKey ? USERS[userKey] : null;
  return db.transaction(async tx => {
    await tx.exec(`set local request.jwt.claim.sub = '${u?.id ?? ''}'; set local role ${u ? 'authenticated' : 'anon'};`);
    return fn({
      q: async (sql, params) => (await tx.query(sql, params)).rows,
      one: async (sql, params) => (await tx.query(sql, params)).rows[0] ?? null
    });
  });
}
const q = async (sql, params) => { await ready; return as(current, t => t.q(sql, params)); };
const one = async (sql, params) => { await ready; return as(current, t => t.one(sql, params)); };
const rpc = async (name, args) => {
  const keys = Object.keys(args);
  const row = await one(`select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, keys.map(k => args[k]));
  return row?.r;
};

async function seed() {
  const run = (user, sql, params) => as(user, t => t.q(sql, params));
  const call = async (user, name, args) => {
    const keys = Object.keys(args);
    return (await run(user, `select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, keys.map(k => args[k])))[0].r;
  };
  const h = await call('alex', 'create_household', { p_name: 'Wohnung', p_display_name: 'Alex' });
  const inv = await call('alex', 'create_invite', { p_household: h });
  await call('robin', 'accept_invite', { p_token: inv.token, p_display_name: 'Robin' });
  const robinMember = (await db.query('select id from public.members where user_id = $1', [USERS.robin.id])).rows[0].id;
  await call('alex', 'set_member_status', { p_member: robinMember, p_action: 'approve' });
  const k = await run('alex', 'select * from public.reserve_labels($1, $2, $3)', [h, 'K', 12]);
  const o = await run('alex', 'select * from public.reserve_labels($1, $2, $3)', [h, 'O', 4]);
  const locs = [];
  for (const [i, name] of ['Keller › Regal 1', 'Dachboden'].entries()) {
    locs.push((await call('alex', 'claim_label', { p_code: o[i].code, p_name: name })).id);
  }
  const boxes = [
    ['robin', 'Weihnachtsdeko', 1, ['2x Lichterkette innen', '12x Christbaumkugeln rot', 'Baumspitze Stern', 'Verlängerungskabel 5 m']],
    ['alex', 'Werkzeug', 0, ['Akkuschrauber', 'Bit-Set', 'Wasserwaage 60 cm', 'Schrauben & Dübel, gemischt']],
    ['alex', 'Kabel & Adapter', 0, ['3x HDMI-Kabel 2 m', 'HDMI-Adapter USB-C', '4x Netzwerkkabel', '5x USB-Ladegeräte']],
    ['robin', 'Camping', null, ['Zelt 3 Personen', '2x Isomatten', 'Gaskocher', '3x Stirnlampen']]
  ];
  for (const [i, [user, name, li, items]] of boxes.entries()) {
    const b = await call(user, 'claim_label', { p_code: k[i].code, p_name: name, p_location: li == null ? null : locs[li] });
    for (const s of items) {
      const m = s.match(/^(\d+)x (.+)$/);
      await run(i % 2 && s === items.at(-1) ? 'alex' : user, 'insert into public.items (box_id, name, qty) values ($1, $2, $3)', [b.id, m ? m[2] : s, m ? Number(m[1]) : 1]);
    }
  }
}

// ---------- Schnittstelle wie js/core/api.js ----------

export function initApi() {}

export const auth = {
  async session() { await ready; return current ? { user: USERS[current] } : null; },
  onChange(cb) { authListeners.push(cb); },
  async sendCode() { await ready; },
  async verifyCode(email) {
    const key = Object.keys(USERS).find(k => USERS[k].email === email) ?? 'neu';
    if (!key) throw new Error('Token has expired or is invalid');
    current = key;
    sessionStorage.setItem('qr_mock_user', key);
  },
  async signOut() {
    current = null;
    sessionStorage.setItem('qr_mock_user', 'none');
    for (const cb of authListeners) cb('SIGNED_OUT', null);
  }
};

export const memberships = userId => q(`select m.id, m.household_id, m.role, m.status, m.display_name, json_build_object('name', h.name) as households
  from public.members m left join public.households h on h.id = m.household_id where m.user_id = $1`, [userId]);
export const members = h => q('select id, user_id, display_name, role, status, created_at from public.members where household_id = $1 order by created_at', [h]);
export const createHousehold = (name, displayName) => rpc('create_household', { p_name: name, p_display_name: displayName });
export const renameHousehold = (h, name) => q('update public.households set name = $2 where id = $1', [h, name]);
export const createInvite = h => rpc('create_invite', { p_household: h });
export const acceptInvite = (token, displayName) => rpc('accept_invite', { p_token: token, p_display_name: displayName });
export const setMemberStatus = (memberId, action) => rpc('set_member_status', { p_member: memberId, p_action: action });

export const resolve = code => rpc('resolve_label', { p_code: code });
export const claim = (code, name, locationId) => rpc('claim_label', { p_code: code, p_name: name, p_location: locationId || null });
export const reserveLabels = (h, kind, count) => q('select * from public.reserve_labels($1, $2, $3)', [h, kind, count]);
export const blockLabel = code => rpc('block_label', { p_code: code });
export const labels = h => q('select code, kind, number, status from public.labels where household_id = $1 order by kind, number', [h]);
export async function codeForNumber(h, kind, number) {
  return (await one('select code from public.labels where household_id = $1 and kind = $2 and number = $3', [h, kind, number]))?.code ?? null;
}

const BOX_COLS = `b.id, b.name, b.location_id, b.label_code,
  case when l.code is null then null else json_build_object('number', l.number) end as labels,
  json_build_array(json_build_object('count', (select count(*)::int from public.items i where i.box_id = b.id and i.removed_at is null))) as items`;

export async function overview(h) {
  const [boxes, locations, free, events] = await Promise.all([
    q(`select ${BOX_COLS} from public.boxes b left join public.labels l on l.code = b.label_code where b.household_id = $1`, [h]),
    q(`select o.id, o.name, o.label_code, case when l.code is null then null else json_build_object('number', l.number) end as labels
       from public.locations o left join public.labels l on l.code = o.label_code where o.household_id = $1 order by o.name`, [h]),
    one(`select count(*)::int as n from public.labels where household_id = $1 and kind = 'K' and status = 'free'`, [h]),
    q('select id, box_id, actor_id, action, detail, at from public.events where household_id = $1 order by at desc limit 8', [h])
  ]);
  return { boxes, locations, freeLabels: free.n, events };
}

export async function box(id) {
  const [b, items] = await Promise.all([
    one(`select b.id, b.name, b.household_id, b.created_at, b.created_by, b.label_code,
      case when l.code is null then null else json_build_object('number', l.number) end as labels,
      case when o.id is null then null else json_build_object('id', o.id, 'name', o.name,
        'labels', (select json_build_object('number', ol.number) from public.labels ol where ol.code = o.label_code)) end as locations
      from public.boxes b left join public.labels l on l.code = b.label_code left join public.locations o on o.id = b.location_id where b.id = $1`, [id]),
    activeItems(id)
  ]);
  return b ? { box: b, items } : null;
}
export const activeItems = boxId => q('select id, name, qty, note, created_by, created_at from public.items where box_id = $1 and removed_at is null order by created_at', [boxId]);
export const removedItems = boxId => q('select id, name, qty, removed_at, removed_by from public.items where box_id = $1 and removed_at is not null order by removed_at desc limit 30', [boxId]);
export const boxEvents = boxId => q('select id, actor_id, action, detail, at from public.events where box_id = $1 order by at desc limit 15', [boxId]);
export async function addItems(boxId, list) {
  await ready;
  return as(current, async t => {
    const out = [];
    for (const x of list) out.push(...await t.q('insert into public.items (box_id, name, qty) values ($1, $2, $3) returning id', [boxId, x.name, x.qty]));
    return out;
  });
}
export async function updateItem(id, patch) {
  const keys = Object.keys(patch);
  return q(`update public.items set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1`, [id, ...keys.map(k => patch[k])]);
}
export const removeItem = id => updateItem(id, { removed_at: new Date().toISOString() });
export const restoreItem = id => updateItem(id, { removed_at: null });
export const renameBox = (id, name) => q('update public.boxes set name = $2 where id = $1', [id, name]);
export const moveBox = (id, locationId) => q('update public.boxes set location_id = $2 where id = $1', [id, locationId]);

export async function location(id) {
  const [loc, boxes] = await Promise.all([
    one(`select o.id, o.name, o.label_code, case when l.code is null then null else json_build_object('number', l.number) end as labels
         from public.locations o left join public.labels l on l.code = o.label_code where o.id = $1`, [id]),
    q(`select ${BOX_COLS} from public.boxes b left join public.labels l on l.code = b.label_code where b.location_id = $1`, [id])
  ]);
  return loc ? { location: loc, boxes } : null;
}
export const locations = h => q(`select o.id, o.name, case when l.code is null then null else json_build_object('number', l.number) end as labels
  from public.locations o left join public.labels l on l.code = o.label_code where o.household_id = $1 order by o.name`, [h]);
export const renameLocation = (id, name) => q('update public.locations set name = $2 where id = $1', [id, name]);

export const search = (h, term) => q('select * from public.search($1, $2)', [h, term]);
