// Einziger Zugriff auf Supabase. Bibliothek: vendor/supabase.js (globale Variable "supabase").
import { CONFIG } from './config.js';

let sb = null;

export function initApi() {
  sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce', storageKey: 'qr_auth' }
  });
}

export { errorText } from './errors.js';

async function run(promise) {
  const { data, error } = await promise;
  if (error) throw error;
  return data;
}
const rpc = (name, args) => run(sb.rpc(name, args));

// ---------- Anmeldung ----------
export const auth = {
  async session() {
    return (await run(sb.auth.getSession())).session;
  },
  onChange(cb) {
    sb.auth.onAuthStateChange((event, session) => cb(event, session));
  },
  sendCode: (email, redirectTo) => run(sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo, shouldCreateUser: true } })),
  verifyCode: (email, token) => run(sb.auth.verifyOtp({ email, token, type: 'email' })),
  signOut: () => run(sb.auth.signOut())
};

// ---------- Haushalt ----------
export const memberships = userId =>
  run(sb.from('members').select('id, household_id, role, status, display_name, households(name)').eq('user_id', userId));
export const members = h =>
  run(sb.from('members').select('id, user_id, display_name, role, status, created_at').eq('household_id', h).order('created_at'));
export const createHousehold = (name, displayName) => rpc('create_household', { p_name: name, p_display_name: displayName });
export const renameHousehold = (h, name) => run(sb.from('households').update({ name }).eq('id', h));
export const createInvite = h => rpc('create_invite', { p_household: h });
export const acceptInvite = (token, displayName) => rpc('accept_invite', { p_token: token, p_display_name: displayName });
export const setMemberStatus = (memberId, action) => rpc('set_member_status', { p_member: memberId, p_action: action });

// ---------- Scan und Etiketten ----------
export const resolve = code => rpc('resolve_label', { p_code: code });
export const claim = (code, name, type, parentId) => rpc('claim_label', { p_code: code, p_name: name, p_type: type || null, p_parent: parentId || null });
export const reserveLabels = (h, kind, count) => rpc('reserve_labels', { p_household: h, p_kind: kind, p_count: count });
export const blockLabel = code => rpc('block_label', { p_code: code });
export const labels = h =>
  run(sb.from('labels').select('code, kind, number, status').eq('household_id', h).order('kind').order('number'));
export async function codeForNumber(h, kind, number) {
  const rows = await run(sb.from('labels').select('code').eq('household_id', h).eq('kind', kind).eq('number', number).limit(1));
  return rows[0]?.code ?? null;
}

// ---------- Übersicht ----------
export async function overview(h) {
  const [boxes, free, events, taken] = await Promise.all([
    things(h),
    sb.from('labels').select('code', { count: 'exact', head: true }).eq('household_id', h).eq('status', 'free'),
    run(sb.from('events').select('id, box_id, actor_id, action, detail, at').eq('household_id', h)
      .order('at', { ascending: false }).limit(8)),
    // Gerade entnommen: was aus irgendeiner Kiste fehlt, neueste zuerst
    run(sb.from('items').select('id, name, qty, removed_at, removed_by, box_id, boxes(name)').eq('household_id', h)
      .not('removed_at', 'is', null).order('removed_at', { ascending: false }).limit(10))
  ]);
  return { boxes, freeLabels: free.count ?? 0, events, taken };
}

// ---------- Dinge (Kisten, Orte, Einzelstücke) ----------
// Alle Dinge des Haushalts, flach; Baum und Pfade baut die Oberfläche.
export const things = h =>
  run(sb.from('boxes').select('id, name, type, parent_id, items(count)').eq('household_id', h).is('items.removed_at', null).order('name'));
// Ein Ding mit Pfad, darin steckenden Dingen und Gegenständen; null ohne Zugriff
export const box = id => rpc('get_thing', { p_id: id });
export const changeType = (id, type) => rpc('change_type', { p_id: id, p_type: type });
export const removedItems = boxId =>
  run(sb.from('items').select('id, name, qty, removed_at, removed_by').eq('box_id', boxId).not('removed_at', 'is', null)
    .order('removed_at', { ascending: false }).limit(30));
export const boxEvents = boxId =>
  run(sb.from('events').select('id, actor_id, action, detail, at').eq('box_id', boxId).order('at', { ascending: false }).limit(15));
export const addItems = (boxId, list) =>
  run(sb.from('items').insert(list.map(x => ({ box_id: boxId, name: x.name, qty: x.qty }))).select('id'));
export const updateItem = (id, patch) => run(sb.from('items').update(patch).eq('id', id));
export const removeItem = id => updateItem(id, { removed_at: new Date().toISOString() });
export const restoreItem = id => updateItem(id, { removed_at: null });
export const renameBox = (id, name) => run(sb.from('boxes').update({ name }).eq('id', id));

// ---------- Fotos (privater Bucket box-photos, Pfad <haushalt>/<kiste>/<zufall>.jpg) ----------
const PHOTOS = 'box-photos';
export async function photos(boxId) {
  const rows = await run(sb.from('box_photos').select('id, path, created_by, created_at').eq('box_id', boxId).order('created_at'));
  if (!rows.length) return [];
  // Signierte Adressen gelten eine Stunde; die Ansicht lädt sie bei jedem Öffnen neu.
  const signed = await run(sb.storage.from(PHOTOS).createSignedUrls(rows.map(r => r.path), 3600));
  const url = new Map(signed.map(s => [s.path, s.signedUrl]));
  return rows.map(r => ({ ...r, url: url.get(r.path) }));
}
export async function addPhoto(householdId, boxId, blob) {
  const path = `${householdId}/${boxId}/${crypto.randomUUID()}.jpg`;
  await run(sb.storage.from(PHOTOS).upload(path, blob, { contentType: 'image/jpeg' }));
  try {
    await run(sb.from('box_photos').insert({ box_id: boxId, path }));
  } catch (e) {
    await sb.storage.from(PHOTOS).remove([path]);
    throw e;
  }
}
export async function deletePhoto(photo) {
  await run(sb.from('box_photos').delete().eq('id', photo.id));
  await sb.storage.from(PHOTOS).remove([photo.path]);
}
// ---------- Gegenstandsfotos (gleicher Bucket, Pfad <haushalt>/<kiste>/items/<zufall>.png|.jpg) ----------
export async function itemPhotos(boxId) {
  const rows = await run(sb.from('item_photos').select('id, item_id, path, cutout, created_by, created_at').eq('box_id', boxId));
  if (!rows.length) return [];
  const signed = await run(sb.storage.from(PHOTOS).createSignedUrls(rows.map(r => r.path), 3600));
  const url = new Map(signed.map(s => [s.path, s.signedUrl]));
  return rows.map(r => ({ ...r, url: url.get(r.path) }));
}
// Ein Foto pro Gegenstand: neues hochladen, altes Eintrag und Datei entfernen, neuen Eintrag anlegen.
export async function setItemPhoto(householdId, boxId, itemId, blob, cutout) {
  const png = blob.type === 'image/png';
  const path = `${householdId}/${boxId}/items/${crypto.randomUUID()}.${png ? 'png' : 'jpg'}`;
  await run(sb.storage.from(PHOTOS).upload(path, blob, { contentType: png ? 'image/png' : 'image/jpeg' }));
  try {
    const old = await run(sb.from('item_photos').delete().eq('item_id', itemId).select('path'));
    await run(sb.from('item_photos').insert({ item_id: itemId, path, cutout }));
    if (old.length) await sb.storage.from(PHOTOS).remove(old.map(o => o.path));
  } catch (e) {
    await sb.storage.from(PHOTOS).remove([path]);
    throw e;
  }
}
export async function deleteItemPhoto(photo) {
  await run(sb.from('item_photos').delete().eq('id', photo.id));
  await sb.storage.from(PHOTOS).remove([photo.path]);
}
export const moveBox = (id, parentId) => run(sb.from('boxes').update({ parent_id: parentId || null }).eq('id', id));

// ---------- Ausleihen (Personen ohne App-Zugang, nur Name und Telefon) ----------
export const borrowers = h => run(sb.from('borrowers').select('id, name, phone').eq('household_id', h).order('name'));
export const addBorrower = (h, name, phone) =>
  run(sb.from('borrowers').insert({ household_id: h, name, phone: phone || null }).select('id, name, phone').single());
export const deleteBorrower = id => run(sb.from('borrowers').delete().eq('id', id));
const LEND_COLS = 'id, box_id, borrower_id, lent_at, remind_at, returned_at, note, borrowers(name, phone)';
export const boxLendings = boxId =>
  run(sb.from('lendings').select(LEND_COLS).eq('box_id', boxId).order('lent_at', { ascending: false }).limit(20));
export const openLendings = h =>
  run(sb.from('lendings').select(LEND_COLS + ', boxes(name, type)').eq('household_id', h).is('returned_at', null)
    .order('remind_at', { ascending: true, nullsFirst: false }));
export const lend = (boxId, borrowerId, remindAt, note) =>
  run(sb.from('lendings').insert({ box_id: boxId, borrower_id: borrowerId, remind_at: remindAt || null, note: note || null }));
export const returnLending = id => run(sb.from('lendings').update({ returned_at: new Date().toISOString() }).eq('id', id));
export const remindLater = (id, remindAt) => run(sb.from('lendings').update({ remind_at: remindAt }).eq('id', id));

// ---------- Suche ----------
export const search = (h, q) => rpc('search', { p_household: h, p_q: q });
