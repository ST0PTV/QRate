// QRate – Start, Anmelde-Schranke und Router.
// Interne Seiten über den Hash (#/box/…); QR-Codes kommen als ?k=CODE an, Einladungen als ?invite=TOKEN.
import { isConfigured } from './core/config.js';
import { initApi, auth, memberships, members, errorText, codeForNumber } from './core/api.js';
import { store } from './core/store.js';
import { esc, toast } from './core/ui.js';
import { parseLabelInput } from './core/code.js';
import { setupView, loginView, onboardingView, pendingView } from './features/auth.js';
import homeView from './features/home.js';
import { resolveView, boxView, locationView } from './features/box.js';
import scanView from './features/scan.js';
import searchView from './features/search.js';
import { labelsView, printView } from './features/labels.js';
import householdView from './features/household.js';

const ROUTES = [
  [/^$/, homeView],
  [/^k\/([0-9A-Z]{8})$/, resolveView],
  [/^box\/([0-9a-f-]{36})$/, boxView],
  [/^loc\/([0-9a-f-]{36})$/, locationView],
  [/^scan$/, scanView],
  [/^suche$/, searchView],
  [/^etiketten$/, labelsView],
  [/^druck$/, printView],
  [/^haushalt$/, householdView]
];

const main = document.getElementById('main');
const titleEl = document.getElementById('title');
const subEl = document.getElementById('subtitle');
const backBtn = document.getElementById('back');
const tabs = document.querySelector('.tabs');

// Gemeinsamer Zustand der App
const app = {
  session: null,
  user: null,
  memberships: [],
  membership: null,      // aktueller Haushalt (eigene Mitgliedszeile + households.name)
  names: new Map(),      // user_id -> Anzeigename im aktuellen Haushalt
  gate: null,            // Anmelde-Schranke: 'setup' | 'login' | 'onboarding' | 'pending' | null
  get household() { return this.membership?.household_id ?? null; },
  get isAdmin() { return this.membership?.role === 'admin'; },
  name(userId) { return this.names.get(userId) ?? 'Unbekannt'; }
};

let view = null;
let renderSeq = 0;
let painted = false;

const ctx = {
  app,
  main,
  go(hash) {
    const target = '#/' + hash.replace(/^#?\/?/, '');
    if (location.hash === target) show(); else location.hash = target;
  },
  rerender: () => show({ keepScroll: true }),
  // Sofort etwas zeigen (z. B. zwischengespeicherten Stand), während die Seite noch lädt
  paint(html) {
    painted = true;
    main.innerHTML = html;
  },
  setTitle(title, sub = '', back = false) {
    titleEl.textContent = title;
    subEl.textContent = sub;
    backBtn.hidden = !back;
  },
  reloadSession: () => boot(),
  async switchHousehold(id) {
    store.setHousehold(id);
    store.clearCache();
    await loadHousehold();
    ctx.go('');
  },
  // Eingabe (Code, Adresse oder Nummer) öffnen; liefert false bei Unsinn
  async openLabel(input) {
    const p = parseLabelInput(input);
    if (!p) return false;
    if (p.code) { ctx.go('k/' + p.code); return true; }
    const code = await codeForNumber(app.household, p.kind, p.number);
    if (!code) return false;
    ctx.go('k/' + code);
    return true;
  }
};

// ---------- Rendering ----------

function currentRoute() {
  const path = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  for (const [re, v] of ROUTES) {
    const m = path.match(re);
    if (m) return { view: v, params: m.slice(1) };
  }
  return { view: homeView, params: [] };
}

async function show({ keepScroll = false } = {}) {
  const seq = ++renderSeq;
  const gateViews = { setup: setupView, login: loginView, onboarding: onboardingView, pending: pendingView };
  const next = app.gate ? { view: gateViews[app.gate], params: [] } : currentRoute();
  if (view && view !== next.view) view.leave?.();
  view = next.view;
  document.body.classList.toggle('gated', Boolean(app.gate));
  document.body.dataset.view = view.id ?? '';
  for (const b of tabs.querySelectorAll('[data-tab]')) {
    if (b.dataset.tab === view.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  painted = false;
  const slow = setTimeout(() => { if (seq === renderSeq && !painted) main.innerHTML = '<p class="loading">Lädt …</p>'; }, 180);
  try {
    const html = await view.render(ctx, ...next.params);
    if (seq !== renderSeq) return; // inzwischen weiternavigiert
    if (typeof html === 'string') main.innerHTML = html;
    view.mounted?.(ctx, ...next.params);
    if (!keepScroll) window.scrollTo(0, 0);
  } catch (e) {
    if (seq !== renderSeq) return;
    console.error(e);
    main.innerHTML = `<div class="card empty"><p>${esc(errorText(e))}</p><button class="btn" data-global="retry">Erneut versuchen</button></div>`;
  } finally {
    clearTimeout(slow);
  }
}

// Ereignisse einmal am Hauptbereich; die aktuelle Seite liefert die Handler.
main.addEventListener('click', async e => {
  const g = e.target.closest('[data-global]');
  if (g?.dataset.global === 'retry') { show(); return; }
  const el = e.target.closest('[data-act]');
  if (!el || !view?.actions?.[el.dataset.act]) return;
  e.preventDefault();
  await guard(() => view.actions[el.dataset.act](el, ctx), el);
});
main.addEventListener('submit', async e => {
  const f = e.target.closest('form[data-form]');
  if (!f || !view?.forms?.[f.dataset.form]) return;
  e.preventDefault();
  await guard(() => view.forms[f.dataset.form](f, ctx), f.querySelector('button[type=submit], button:not([type])'));
});
main.addEventListener('input', e => view?.input?.[e.target.id]?.(e.target, ctx));
main.addEventListener('change', e => view?.change?.[e.target.id]?.(e.target, ctx));

// Doppelklicks abfangen und Fehler als Meldung zeigen
async function guard(fn, el) {
  if (el?.dataset.busy) return;
  if (el) { el.dataset.busy = '1'; el.setAttribute('aria-busy', 'true'); }
  try {
    await fn();
  } catch (err) {
    console.error(err);
    toast(errorText(err), 'error');
  } finally {
    if (el) { delete el.dataset.busy; el.removeAttribute('aria-busy'); }
  }
}

tabs.addEventListener('click', e => {
  const b = e.target.closest('[data-tab]');
  if (b && !app.gate) ctx.go(b.dataset.route);
});
backBtn.addEventListener('click', () => (history.length > 1 ? history.back() : ctx.go('')));
window.addEventListener('hashchange', () => show());

// ---------- Start ----------

// ?k= und ?invite= merken und aus der Adresse entfernen (Hash und Supabase-Parameter bleiben)
function takeUrlParams() {
  const u = new URL(location.href);
  const k = u.searchParams.get('k');
  const inv = u.searchParams.get('invite');
  if (k) { const p = parseLabelInput(k); if (p?.code) store.setPendingCode(p.code); }
  if (inv) store.setPendingInvite(inv.toUpperCase());
  if (k || inv) {
    u.searchParams.delete('k');
    u.searchParams.delete('invite');
    history.replaceState(null, '', u.pathname + u.search + u.hash);
  }
}

function cleanAuthParams() {
  const u = new URL(location.href);
  if (!u.searchParams.has('code') && !u.searchParams.has('error_description')) return;
  const err = u.searchParams.get('error_description');
  u.searchParams.delete('code');
  u.searchParams.delete('error');
  u.searchParams.delete('error_code');
  u.searchParams.delete('error_description');
  history.replaceState(null, '', u.pathname + u.search + u.hash);
  if (err) toast(err, 'error');
}

async function loadHousehold() {
  app.memberships = await memberships(app.user.id);
  const active = app.memberships.filter(m => m.status === 'active');
  app.membership = active.find(m => m.household_id === store.household()) ?? active[0] ?? null;
  app.names = new Map();
  if (!app.membership) {
    app.gate = app.memberships.length ? 'pending' : 'onboarding';
    return;
  }
  store.setHousehold(app.membership.household_id);
  const list = await members(app.membership.household_id);
  app.names = new Map(list.map(m => [m.user_id, m.display_name]));
  app.gate = null;
}

async function boot() {
  if (!isConfigured()) { app.gate = 'setup'; return show(); }
  try {
    app.session = await auth.session();
    cleanAuthParams();
    app.user = app.session?.user ?? null;
    if (!app.user) { app.gate = 'login'; return show(); }
    if (store.pendingInvite()) { app.gate = 'onboarding'; return show(); }
    await loadHousehold();
    if (!app.gate) {
      const code = store.pendingCode();
      if (code) {
        store.setPendingCode(null);
        location.hash = '#/k/' + code;
      }
    }
  } catch (e) {
    console.error(e);
    toast(errorText(e), 'error');
    if (!app.user) app.gate = 'login';
  }
  show();
}

takeUrlParams();
if (isConfigured()) {
  initApi();
  auth.onChange((event, session) => {
    if (event === 'SIGNED_OUT') { app.session = null; app.user = null; app.gate = 'login'; show(); }
    if (event === 'SIGNED_IN' && session?.user?.id !== app.user?.id) boot();
  });
}
boot();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => { /* ohne Offline-Cache weiter */ });
}
