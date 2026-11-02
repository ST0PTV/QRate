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
export const claim = (code, name, locationId) => rpc('claim_label', { p_code: code, p_name: name, p_location: locationId || null });
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
  const [boxes, locations, free, events] = await Promise.all([
    run(sb.from('boxes').select('id, name, location_id, label_code, labels(number), items(count)')
      .eq('household_id', h).is('items.removed_at', null)),
    run(sb.from('locations').select('id, name, label_code, labels(number)').eq('household_id', h).order('name')),
    sb.from('labels').select('code', { count: 'exact', head: true }).eq('household_id', h).eq('kind', 'K').eq('status', 'free'),
    run(sb.from('events').select('id, box_id, actor_id, action, detail, at').eq('household_id', h)
      .order('at', { ascending: false }).limit(8))
  ]);
  return { boxes, locations, freeLabels: free.count ?? 0, events };
}

// ---------- Kisten ----------
export async function box(id) {
  const [b, items] = await Promise.all([
    run(sb.from('boxes').select('id, name, household_id, created_at, created_by, label_code, labels(number), locations(id, name, labels(number))')
      .eq('id', id).maybeSingle()),
    activeItems(id)
  ]);
  return b ? { box: b, items } : null;
}
export const activeItems = boxId =>
  run(sb.from('items').select('id, name, qty, note, created_by, created_at').eq('box_id', boxId).is('removed_at', null).order('created_at'));
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
export const moveBox = (id, locationId) => run(sb.from('boxes').update({ location_id: locationId }).eq('id', id));

// ---------- Orte ----------
export async function location(id) {
  const [loc, boxes] = await Promise.all([
    run(sb.from('locations').select('id, name, label_code, labels(number)').eq('id', id).maybeSingle()),
    run(sb.from('boxes').select('id, name, labels(number), items(count)').eq('location_id', id).is('items.removed_at', null))
  ]);
  return loc ? { location: loc, boxes } : null;
}
export const locations = h =>
  run(sb.from('locations').select('id, name, labels(number)').eq('household_id', h).order('name'));
export const renameLocation = (id, name) => run(sb.from('locations').update({ name }).eq('id', id));

// ---------- Suche ----------
export const search = (h, q) => rpc('search', { p_household: h, p_q: q });
