// Scan-Ergebnis, Kiste, Ort und das Anlegen über ein freies Etikett.
import * as api from '../core/api.js';
import { store } from '../core/store.js';
import { parseQuick } from '../core/parse.js';
import { humanNumber } from '../core/code.js';
import { esc, icon, tag, fmtDay, fmtTime, eventText, toast } from '../core/ui.js';
import { boxRow } from './home.js';

// Zustand der geöffneten Kiste (Panels, nachgeladene Listen)
const st = { boxId: null, code: null, panel: null, locations: null, removed: null };

function resetFor(boxId) {
  if (st.boxId === boxId) return;
  Object.assign(st, { boxId, panel: null, locations: null, removed: null });
}

// ---------- Darstellung ----------

function itemHtml(it) {
  if (st.panel === 'edit:' + it.id) {
    return `<form class="item editing" data-form="saveItem" data-id="${it.id}">
      <input class="input qty-input" id="eqty" type="number" min="1" max="99999" value="${it.qty}" aria-label="Menge">
      <input class="input grow" id="ename" maxlength="120" required value="${esc(it.name)}" aria-label="Name">
      <input class="input wide-field" id="enote" maxlength="500" placeholder="Notiz (optional)" value="${esc(it.note)}" aria-label="Notiz">
      <div class="btn-row"><button class="btn primary small" type="submit">Speichern</button>
      <button class="btn ghost small" type="button" data-act="panel" data-v="">Abbrechen</button></div>
    </form>`;
  }
  return `<div class="item">
    <span class="qty">${it.qty}×</span>
    <div class="grow">
      <div class="item-name">${esc(it.name)}</div>
      ${it.note ? `<div class="item-note">${esc(it.note)}</div>` : ''}
      <div class="meta">${esc(it.by)} · ${fmtDay(it.created_at)}</div>
    </div>
    <button class="icon-btn" data-act="panel" data-v="edit:${it.id}" aria-label="${esc(it.name)} bearbeiten" title="Bearbeiten">${icon('edit')}</button>
    <button class="icon-btn take" data-act="take" data-id="${it.id}" data-name="${esc(it.name)}" aria-label="${esc(it.name)} entnehmen" title="Entnehmen">${icon('takeout')}</button>
  </div>`;
}

function panelHtml(b) {
  if (st.panel === 'add') {
    return `<form class="card stack" data-form="add">
      <label class="field"><span>Komma trennt, „3x“ setzt die Menge. Die Diktierfunktion der Tastatur funktioniert auch.</span>
        <textarea class="input" id="quick" rows="3" placeholder="3x Christbaumkugeln, Lichterkette, Kabelbinder x20"></textarea></label>
      <p class="muted small" id="quickPreview"></p>
      <div class="btn-row"><button class="btn primary" type="submit">Hinzufügen</button>
      <button class="btn ghost" type="button" data-act="panel" data-v="">Schließen</button></div>
    </form>`;
  }
  if (st.panel === 'rename') {
    return `<form class="card stack" data-form="rename">
      <label class="field"><span>Name der Kiste</span><input class="input" id="boxName" maxlength="80" required value="${esc(b.name)}"></label>
      <div class="btn-row"><button class="btn primary" type="submit">Speichern</button>
      <button class="btn ghost" type="button" data-act="panel" data-v="">Abbrechen</button></div>
    </form>`;
  }
  if (st.panel === 'move') {
    const locs = st.locations ?? [];
    return `<div class="card stack">
      <h3>Wohin kommt ${humanNumber('K', b.number)}?</h3>
      <button class="btn primary" data-act="moveScan">${icon('scan')} Orts-Etikett scannen</button>
      <div class="choice-list">
        ${locs.map(l => `<button class="choice${l.id === b.location?.id ? ' current' : ''}" data-act="moveTo" data-id="${l.id}">
          ${tag('O', l.labels?.number)}<span>${esc(l.name)}</span></button>`).join('')}
        ${b.location ? '<button class="choice" data-act="moveTo" data-id="">Ohne Ort</button>' : ''}
      </div>
      ${locs.length ? '' : '<p class="muted small">Noch keine Orte. Klebe ein O-Etikett an ein Regal und scanne es, um einen Ort anzulegen.</p>'}
      <button class="btn ghost" data-act="panel" data-v="">Abbrechen</button>
    </div>`;
  }
  return '';
}

function boxHtml(p, { cachedAt } = {}) {
  const b = p.box;
  const loc = b.location;
  return `
    ${cachedAt ? `<p class="note">Gespeicherter Stand vom ${fmtTime(cachedAt)}, wird aktualisiert …</p>` : ''}
    <section class="box-head">
      <div class="big-tag">${humanNumber('K', b.number)}</div>
      <div class="grow">
        <h1>${esc(b.name)}</h1>
        <p class="muted small">${loc ? `<a href="#/loc/${loc.id}">${icon('pin', 'inline')}${esc(loc.name)}</a>` : 'Noch kein Ort'}
          · angelegt von ${esc(b.created_by_name)} am ${fmtDay(b.created_at)}</p>
      </div>
    </section>
    <div class="actions3">
      <button class="btn${st.panel === 'add' ? ' primary' : ''}" data-act="panel" data-v="add">${icon('plus')} Hinzufügen</button>
      <button class="btn${st.panel === 'move' ? ' primary' : ''}" data-act="panel" data-v="move">${icon('move')} Verschieben</button>
      <button class="btn${st.panel === 'rename' ? ' primary' : ''}" data-act="panel" data-v="rename">${icon('edit')} Umbenennen</button>
    </div>
    <p class="muted small">${icon('takeout', 'inline')} nimmt einen Gegenstand heraus. Er bleibt im Verlauf und lässt sich zurücklegen.</p>
    ${panelHtml(b)}
    <section class="card">
      <div class="card-head"><h3>Inhalt</h3><span class="muted small">${p.items.length} ${p.items.length === 1 ? 'Eintrag' : 'Einträge'}</span></div>
      ${p.items.length ? `<div class="items">${p.items.map(itemHtml).join('')}</div>`
        : '<p class="muted">Noch leer. Tippe auf „Hinzufügen“.</p>'}
      ${st.removed ? `<h4 class="sub">Entnommen</h4><div class="items">${st.removed.length ? st.removed.map(r => `<div class="item removed">
          <span class="qty">${r.qty}×</span><div class="grow"><div class="item-name">${esc(r.name)}</div>
          <div class="meta">entnommen von ${esc(r.by)} am ${fmtDay(r.removed_at)}</div></div>
          <button class="btn small ghost" data-act="restore" data-id="${r.id}">Zurücklegen</button></div>`).join('')
        : '<p class="muted small">Nichts entnommen.</p>'}</div>`
        : '<button class="link-btn" data-act="showRemoved">Entnommene anzeigen</button>'}
    </section>
    <section class="card"><h3 class="card-title">Verlauf</h3><div id="events"><p class="muted small">Lädt …</p></div></section>`;
}

function deniedHtml() {
  return `<div class="card empty">
    <div class="lock-ico">${icon('lock')}</div>
    <h2>Kein Zugriff</h2>
    <p class="muted">Dieses Etikett gehört nicht zu deinem Haushalt, ist gesperrt oder existiert nicht.</p>
    <a class="btn" href="#/scan">Zurück zum Scannen</a>
  </div>`;
}

async function freeHtml(p, ctx) {
  const isBox = p.kind === 'K';
  const locs = isBox ? await api.locations(ctx.app.household) : [];
  const moving = store.moving();
  return `<form class="card stack" data-form="claim" data-code="${p.code}">
    <div class="claim-head"><span class="big-tag${isBox ? '' : ' o'}">${humanNumber(p.kind, p.number)}</span>
      <div><h2>${isBox ? 'Neue Kiste anlegen?' : 'Neuen Ort anlegen?'}</h2><p class="muted small">Dieses Etikett ist noch frei.</p></div></div>
    <label class="field"><span>${isBox ? 'Name der Kiste (optional)' : 'Name des Orts'}</span>
      <input class="input" id="claimName" maxlength="80" ${isBox ? '' : 'required'} placeholder="${isBox ? 'z. B. Fotoalben' : 'z. B. Keller › Regal 2'}"></label>
    ${isBox ? `<label class="field"><span>Ort</span><select class="input" id="claimLoc"><option value="">Noch keiner</option>
      ${locs.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select></label>` : ''}
    ${!isBox && moving ? `<p class="note">Danach kommt ${humanNumber('K', moving.number)} „${esc(moving.name)}“ an diesen Ort.</p>` : ''}
    <div class="btn-row"><button class="btn primary" type="submit">Ja, anlegen</button><a class="btn ghost" href="#/scan">Abbrechen</a></div>
  </form>`;
}

function locationHtml(loc, boxes) {
  return `<section class="box-head">
      <div class="big-tag o">${humanNumber('O', loc.number)}</div>
      <div class="grow"><h1>${esc(loc.name)}</h1><p class="muted small">${boxes.length} ${boxes.length === 1 ? 'Kiste' : 'Kisten'}</p></div>
    </section>
    <div class="btn-row"><button class="btn" data-act="renameLoc" data-id="${loc.id}">${icon('edit')} Umbenennen</button></div>
    <div id="locRename"></div>
    <section class="card">${boxes.length ? boxes.map(boxRow).join('')
      : '<p class="muted">Hier steht noch keine Kiste. Öffne eine Kiste und tippe auf „Verschieben“.</p>'}</section>`;
}

// ---------- Daten ----------

// Kiste über die ID laden und in dieselbe Form bringen wie das Scan-Ergebnis
async function loadBox(ctx, id) {
  const r = await api.box(id);
  if (!r) return null;
  const b = r.box;
  return {
    status: 'box',
    box: {
      id: b.id, name: b.name, number: b.labels?.number ?? null, code: b.label_code, created_at: b.created_at,
      created_by_name: ctx.app.name(b.created_by),
      location: b.locations ? { id: b.locations.id, name: b.locations.name, number: b.locations.labels?.number } : null
    },
    items: r.items.map(i => ({ ...i, by: ctx.app.name(i.created_by) }))
  };
}

async function fillEvents(ctx, boxId) {
  const el = document.getElementById('events');
  if (!el) return;
  try {
    const evts = await api.boxEvents(boxId);
    if (!el.isConnected) return;
    el.innerHTML = evts.length ? `<ul class="events">${evts.map(e => `<li><time>${fmtTime(e.at)}</time>
      <span><strong>${esc(ctx.app.name(e.actor_id))}</strong> ${eventText(e)}</span></li>`).join('')}</ul>`
      : '<p class="muted small">Noch nichts passiert.</p>';
  } catch {
    el.innerHTML = '<p class="muted small">Verlauf nicht verfügbar.</p>';
  }
}

async function afterChange(ctx) {
  if (st.code) store.cache(st.code, null);
  if (st.removed) st.removed = null;
  await ctx.rerender();
}

// ---------- Aktionen der Kistenansicht ----------

const boxActions = {
  async panel(el, ctx) {
    const v = el.dataset.v || null;
    st.panel = st.panel === v ? null : v;
    if (st.panel === 'move' && !st.locations) st.locations = await api.locations(ctx.app.household);
    await ctx.rerender();
    if (st.panel === 'add') document.getElementById('quick')?.focus();
  },
  async take(el, ctx) {
    await api.removeItem(el.dataset.id);
    toast(`„${el.dataset.name}“ entnommen`);
    await afterChange(ctx);
  },
  async restore(el, ctx) {
    await api.restoreItem(el.dataset.id);
    await afterChange(ctx);
  },
  async showRemoved(_, ctx) {
    const list = await api.removedItems(st.boxId);
    st.removed = list.map(r => ({ ...r, by: ctx.app.name(r.removed_by) }));
    await ctx.rerender();
  },
  moveScan(_, ctx) {
    const b = st.current;
    store.setMoving({ id: b.id, number: b.number, name: b.name });
    st.panel = null;
    ctx.go('scan');
  },
  async moveTo(el, ctx) {
    await api.moveBox(st.boxId, el.dataset.id || null);
    st.panel = null;
    toast(el.dataset.id ? 'Verschoben' : 'Ort entfernt');
    await afterChange(ctx);
  }
};

const boxForms = {
  async add(f, ctx) {
    const list = parseQuick(f.querySelector('#quick').value);
    if (!list.length) { toast('Bitte mindestens einen Gegenstand eintragen'); return; }
    await api.addItems(st.boxId, list);
    toast(`${list.length} ${list.length === 1 ? 'Eintrag' : 'Einträge'} hinzugefügt`);
    await afterChange(ctx);
    document.getElementById('quick')?.focus();
  },
  async rename(f, ctx) {
    await api.renameBox(st.boxId, f.querySelector('#boxName').value.trim());
    st.panel = null;
    await afterChange(ctx);
  },
  async saveItem(f, ctx) {
    await api.updateItem(f.dataset.id, {
      name: f.querySelector('#ename').value.trim(),
      qty: Math.max(1, Math.min(99999, Number(f.querySelector('#eqty').value) || 1)),
      note: f.querySelector('#enote').value.trim() || null
    });
    st.panel = null;
    await afterChange(ctx);
  }
};

const boxInput = {
  quick(el) {
    const list = parseQuick(el.value);
    const out = document.getElementById('quickPreview');
    if (out) out.textContent = list.length ? list.map(x => `${x.qty}× ${x.name}`).join(' · ') : '';
  }
};

function showBox(ctx, p, opts) {
  resetFor(p.box.id);
  st.current = p.box;
  ctx.setTitle('Kiste', ctx.app.membership.households?.name ?? '', true);
  return boxHtml(p, opts);
}

// ---------- Seiten ----------

export const resolveView = {
  id: 'box',
  tab: 'scan',
  async render(ctx, code) {
    st.code = code;
    const cached = store.cached(code);
    if (cached?.data?.status === 'box') ctx.paint(showBox(ctx, cached.data, { cachedAt: cached.at }));
    let p;
    try {
      p = await api.resolve(code);
    } catch (e) {
      if (cached?.data?.status === 'box') {
        toast('Offline: gespeicherter Stand', 'error');
        return showBox(ctx, cached.data, { cachedAt: cached.at });
      }
      throw e;
    }
    if (p.status === 'signed_out') { store.setPendingCode(code); await ctx.reloadSession(); return; }
    if (p.status === 'denied') { ctx.setTitle('Kein Zugriff', '', true); return deniedHtml(); }
    if (p.status === 'free') {
      ctx.setTitle(humanNumber(p.kind, p.number), 'Freies Etikett', true);
      return freeHtml(p, ctx);
    }
    if (p.status === 'location') {
      const moving = store.moving();
      if (moving) {
        store.setMoving(null);
        await api.moveBox(moving.id, p.location.id);
        store.cache(code, null);
        toast(`${humanNumber('K', moving.number)} steht jetzt in ${p.location.name}`);
        ctx.go('box/' + moving.id);
        return;
      }
      ctx.setTitle(humanNumber('O', p.location.number), 'Ort', true);
      return locationHtml(p.location, p.boxes);
    }
    store.cache(code, p);
    return showBox(ctx, p);
  },
  mounted(ctx) {
    if (st.current && document.getElementById('events')) fillEvents(ctx, st.current.id);
  },
  actions: { ...boxActions, renameLoc },
  forms: { ...boxForms, claim, renameLocation },
  input: boxInput
};

export const boxView = {
  id: 'box',
  tab: 'home',
  async render(ctx, id) {
    const p = await loadBox(ctx, id);
    if (!p) { ctx.setTitle('Kein Zugriff', '', true); return deniedHtml(); }
    st.code = p.box.code;
    return showBox(ctx, p);
  },
  mounted(ctx, id) { fillEvents(ctx, id); },
  actions: boxActions,
  forms: boxForms,
  input: boxInput
};

export const locationView = {
  id: 'location',
  tab: 'home',
  async render(ctx, id) {
    const r = await api.location(id);
    if (!r) { ctx.setTitle('Kein Zugriff', '', true); return deniedHtml(); }
    const loc = { ...r.location, number: r.location.labels?.number };
    ctx.setTitle(humanNumber('O', loc.number), 'Ort', true);
    return locationHtml(loc, r.boxes);
  },
  actions: { renameLoc },
  forms: { renameLocation }
};

// ---------- Ort umbenennen, Etikett zuordnen ----------

function renameLoc(el) {
  const box = document.getElementById('locRename');
  const name = document.querySelector('.box-head h1')?.textContent ?? '';
  box.innerHTML = `<form class="card stack" data-form="renameLocation" data-id="${el.dataset.id}">
    <label class="field"><span>Name des Orts</span><input class="input" id="locName" maxlength="80" required value="${esc(name)}"></label>
    <button class="btn primary" type="submit">Speichern</button></form>`;
  document.getElementById('locName').focus();
}

async function renameLocation(f, ctx) {
  await api.renameLocation(f.dataset.id, f.querySelector('#locName').value.trim());
  if (st.code) store.cache(st.code, null);
  await ctx.rerender();
}

async function claim(f, ctx) {
  const code = f.dataset.code;
  const name = f.querySelector('#claimName').value.trim();
  const loc = f.querySelector('#claimLoc')?.value || null;
  const res = await api.claim(code, name, loc);
  if (res.kind === 'K') {
    st.boxId = res.id;
    st.panel = 'add';
    toast('Kiste angelegt. Jetzt den Inhalt erfassen.');
    await ctx.rerender();
    document.getElementById('quick')?.focus();
    return;
  }
  const moving = store.moving();
  if (moving) {
    store.setMoving(null);
    await api.moveBox(moving.id, res.id);
    toast(`Ort angelegt, ${humanNumber('K', moving.number)} steht jetzt dort`);
    ctx.go('box/' + moving.id);
    return;
  }
  toast('Ort angelegt');
  await ctx.rerender();
}
