// Ansicht eines Dings (Kiste, Ort, Einzelstück) und das Anlegen über ein freies Etikett.
import * as api from '../core/api.js';
import { store } from '../core/store.js';
import { parseQuick } from '../core/parse.js';
import { humanNumber } from '../core/code.js';
import { esc, icon, fmtDay, fmtTime, eventText, toast } from '../core/ui.js';
import { errorText } from '../core/errors.js';
import { shrinkImage, shrinkCutout, clipboardImage } from '../core/photo.js';
import { reminderIcs, downloadIcs, inDays } from '../core/ics.js';
import { TYPES, GROUPS, typeLabel, typeIcon, groupOf, canHold, isPlace, buildTree } from '../core/types.js';
import { buyHtml, buyBadgeHtml, resetBuy, fillPurchases, buyLoaded, purchaseOf, purchaseHandlers } from './purchase.js';
import { activeRound } from './check-round.js';

// Zustand der geöffneten Kiste (Panels, nachgeladene Listen)
const st = { boxId: null, code: null, panel: null, things: null, removed: null, photos: null, photoSel: 0, photoArmed: null,
  itemPhotos: null, shot: null, picArmed: false, picMsg: '' };
const MAX_PHOTOS = 8;

function resetFor(boxId) {
  if (st.boxId === boxId) return;
  Object.assign(st, { boxId, panel: null, things: null, removed: null, photos: null, photoSel: 0, photoArmed: null, itemPhotos: null });
  clearShot();
  resetBuy(boxId);
}

// ---------- Darstellung ----------

// Knopf der Werkzeugleiste; ein offenes Feld (Verschieben, Umbenennen, Typ) ist markiert
const toolBtn = (panel, label, ic) => `<button class="tool${st.panel === panel ? ' on' : ''}" data-act="panel" data-v="${panel}" aria-pressed="${st.panel === panel}">${icon(ic)}<span>${label}</span></button>`;

function itemHtml(it) {
  if (st.panel === 'edit:' + it.id) {
    return `<form class="item editing" data-form="saveItem" data-id="${it.id}">
      <input class="input qty-input" id="eqty" type="number" min="1" max="99999" value="${it.qty}" aria-label="Menge">
      <input class="input grow" id="ename" maxlength="120" required value="${esc(it.name)}" aria-label="Name">
      <input class="input wide-field" id="enote" maxlength="500" placeholder="Notiz (optional)" value="${esc(it.note)}" aria-label="Notiz">
      <div class="btn-row"><button class="btn primary small" type="submit">Speichern</button>
      <button class="btn ghost small" type="button" data-act="panel" data-v="">Abbrechen</button>
      <button class="btn small" type="button" data-act="buyEdit" data-target="${esc(JSON.stringify({ item_id: it.id }))}">${icon('receipt')} Kauf und Garantie</button></div>
    </form>`;
  }
  if (st.panel === 'pic:' + it.id) return `<div class="item item-pic-panel" id="itemPic" data-id="${it.id}">${picPanelHtml(it)}</div>`;
  if (st.panel === 'buy:' + it.id) return `<div class="item item-buy-panel" id="itemBuy" data-id="${it.id}">${buyHtml({ item_id: it.id }, it.name, true)}</div>`;
  return `<div class="item">
    <span class="qty">${it.qty}×</span>
    ${picBtnHtml(it)}
    <button type="button" class="item-main grow" data-act="panel" data-v="edit:${it.id}" aria-label="${esc(it.name)} bearbeiten">
      <span class="item-name">${esc(it.name)}</span>
      ${it.note ? `<span class="item-note">${esc(it.note)}</span>` : ''}
      ${buyBadgeHtml(it.id)}
      <span class="meta">${esc(it.by)} · ${fmtDay(it.created_at)}</span>
    </button>
    <button class="icon-btn take" data-act="take" data-id="${it.id}" data-name="${esc(it.name)}" aria-label="${esc(it.name)} entnehmen" title="Entnehmen">${icon('takeout')}</button>
  </div>`;
}

const typeGrid = (act, current) => GROUPS.map(g => `<h4 class="type-head">${g.title} <span class="muted">· ${g.hint}</span></h4>
  <div class="type-grid">${TYPES.filter(t => t.group === g.key).map(t => `<button type="button" class="type-btn${t.key === current ? ' on' : ''}"
    data-act="${act}" data-v="${t.key}" aria-pressed="${t.key === current}"><span class="type-ico">${icon(t.icon)}</span><span>${t.label}</span></button>`).join('')}</div>`).join('');

// Ziele zum Verschieben: alles, was etwas aufnehmen kann, außer dem Ding selbst und dem, was darin steckt
function moveTargets(b) {
  const tree = buildTree(st.things ?? []);
  const inside = tree.descendants(b.id);
  return (st.things ?? []).filter(t => canHold(t.type) && t.id !== b.id && !inside.has(t.id))
    .map(t => ({ ...t, path: tree.path(t.id) }))
    .sort((x, y) => `${x.path} ${x.name}`.localeCompare(`${y.path} ${y.name}`, 'de'));
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
      <label class="field"><span>Name</span><input class="input" id="boxName" maxlength="80" required value="${esc(b.name)}"></label>
      <div class="btn-row"><button class="btn primary" type="submit">Speichern</button>
      <button class="btn ghost" type="button" data-act="panel" data-v="">Abbrechen</button></div>
    </form>`;
  }
  if (st.panel === 'move') {
    const list = moveTargets(b);
    return `<div class="card stack">
      <h3>Wohin kommt „${esc(b.name)}“?</h3>
      <button class="btn primary" data-act="moveScan">${icon('scan')} Ziel-Etikett scannen</button>
      <div class="choice-list">
        ${list.map(t => `<button class="choice${t.id === b.parent?.id ? ' current' : ''}" data-act="moveTo" data-id="${t.id}">
          <span class="row-ico sm">${icon(typeIcon(t.type))}</span><span class="grow"><span class="choice-name">${esc(t.name)}</span>
          ${t.path ? `<span class="row-sub">${esc(t.path)}</span>` : ''}</span></button>`).join('')}
        ${b.parent ? '<button class="choice" data-act="moveTo" data-id="">Ganz oben, ohne Ort</button>' : ''}
      </div>
      ${list.length ? '' : '<p class="muted small">Noch keine Orte. Klebe ein Etikett an ein Regal, scanne es und wähle einen Ort-Typ.</p>'}
      <button class="btn ghost" data-act="panel" data-v="">Abbrechen</button>
    </div>`;
  }
  if (st.panel === 'type') {
    return `<div class="card stack">
      <h3>Was ist „${esc(b.name)}“?</h3>
      ${typeGrid('setType', b.type)}
      ${canHold(b.type) && (st.childCount || st.itemCount) ? `<p class="note">Wird es ein Einzelstück, kommt der Inhalt dorthin, wo es steht${b.parent ? `: ${esc(b.parent.name)}` : ''}.</p>` : ''}
      <button class="btn ghost" data-act="panel" data-v="">Abbrechen</button>
    </div>`;
  }
  return '';
}

const childRow = c => {
  const n = c.item_count ?? 0;
  const parts = [typeLabel(c.type)];
  if (c.child_count) parts.push(`${c.child_count} darin`);
  if (n) parts.push(n === 1 ? '1 Gegenstand' : `${n} Gegenstände`);
  return `<a class="row-link" href="#/box/${c.id}">
    <span class="row-ico">${icon(typeIcon(c.type))}</span>
    <span class="grow"><span class="row-title">${esc(c.name)}</span><span class="row-sub">${esc(parts.join(' · '))}</span></span>
  </a>`;
};

function boxHtml(p, { cachedAt } = {}) {
  const b = p.box;
  const holds = canHold(b.type);
  const children = p.children ?? [];
  const crumbs = (b.path ?? []).map(x => `<a href="#/box/${x.id}">${esc(x.name)}</a>`).join(' › ');
  return `
    ${cachedAt ? `<p class="note">Gespeicherter Stand vom ${fmtTime(cachedAt)}, wird aktualisiert …</p>` : ''}
    <section class="box-head">
      ${b.code ? `<div class="big-tag${b.kind === 'O' ? ' o' : ''}">${humanNumber(b.kind, b.number)}</div>` : `<div class="big-tag ico">${icon(typeIcon(b.type))}</div>`}
      <div class="grow">
        ${crumbs ? `<p class="crumb">${icon('pin', 'inline')}${crumbs}</p>` : ''}
        <h1>${esc(b.name)}</h1>
        <p class="muted small">${esc(typeLabel(b.type))}${crumbs ? '' : ' · ohne Ort'} · angelegt von ${esc(b.created_by_name)} am ${fmtDay(b.created_at)}</p>
      </div>
    </section>
    ${holds ? `<button class="btn primary wide" data-act="panel" data-v="add" aria-pressed="${st.panel === 'add'}">${icon('plus')} Hinzufügen</button>` : ''}
    <div class="toolbar" role="group" aria-label="Weitere Aktionen">
      ${toolBtn('move', 'Verschieben', 'move')}
      ${toolBtn('rename', 'Umbenennen', 'edit')}
      ${toolBtn('type', 'Typ', typeIcon(b.type))}
      ${holds ? `<button class="tool" data-act="stow">${icon('scan')}<span>Einräumen</span></button>` : ''}
    </div>
    ${holds && !isPlace(b.type) ? checkBarHtml(b, ctxRef) : ''}
    ${panelHtml(b)}
    <section class="card stack" id="buy">${buyCardHtml(b)}</section>
    ${isPlace(b.type) ? '' : `<section class="card stack" id="lending">${lendHtml()}</section>`}
    ${holds && children.length ? `<section class="card">
      <div class="card-head"><h3>${isPlace(b.type) ? 'Hier steht' : 'Darin'}</h3><span class="muted small">${children.length}</span></div>
      ${children.map(childRow).join('')}
    </section>` : ''}
    <section class="card stack photos" id="photos">${photosHtml()}</section>
    ${(holds && !isPlace(b.type)) || p.items.length || st.panel === 'add' ? `<section class="card">
      <div class="card-head"><h3>${isPlace(b.type) ? 'Lose hier' : 'Inhalt'}</h3><span class="muted small">${p.items.length} ${p.items.length === 1 ? 'Eintrag' : 'Einträge'}</span></div>
      ${p.items.length ? `<div class="items">${p.items.map(itemHtml).join('')}</div>`
        : '<p class="muted">Noch leer. Tippe auf „Hinzufügen“.</p>'}
      ${st.removed ? `<h4 class="sub">Entnommen</h4><div class="items">${st.removed.length ? st.removed.map(r => `<div class="item removed">
          <span class="qty">${r.qty}×</span><div class="grow"><div class="item-name">${esc(r.name)}</div>
          <div class="meta">entnommen von ${esc(r.by)} am ${fmtDay(r.removed_at)}</div></div>
          <button class="btn small ghost" data-act="restore" data-id="${r.id}">Zurücklegen</button></div>`).join('')
        : '<p class="muted small">Nichts entnommen.</p>'}</div>`
        : '<button class="link-btn" data-act="showRemoved">Entnommene anzeigen</button>'}
    </section>` : ''}
    <section class="card"><h3 class="card-title">Verlauf</h3><div id="events"><p class="muted small">Lädt …</p></div></section>`;
}

// ---------- Prüfen: „Stimmt so“ merkt sich Zeit und Person; in der Prüfrunde geht es danach zurück zum Scannen ----------

function checkBarHtml(b, ctx) {
  const round = activeRound(ctx);
  return `${round ? `<div class="banner"><span>Prüfrunde: Inhalt ansehen, dann „Stimmt so“ tippen.</span>
      <a class="btn small" href="#/scan">Zum Scannen</a></div>` : ''}
    <div class="check-bar">
      <span class="grow">${icon('shield', 'inline')}${b.checked_at
        ? `Geprüft am ${fmtDay(b.checked_at)}${b.checked_by_name ? ` von ${esc(b.checked_by_name)}` : ''}`
        : 'Noch nie geprüft'}</span>
      <button class="btn small${round ? ' primary' : ''}" data-act="checkOk">${icon('check')} Stimmt so</button>
    </div>`;
}

const checkActions = {
  async checkOk(_, ctx) {
    const b = st.current;
    await api.checkThing(b.id);
    const round = activeRound(ctx);
    if (round) {
      round.done = [{ id: b.id, name: b.name }, ...round.done.filter(d => d.id !== b.id)];
      store.setCheckRound(round);
      if (st.code) store.cache(st.code, null);
      toast(`„${b.name}“ geprüft`);
      ctx.go('scan');
      return;
    }
    toast('Als geprüft gespeichert');
    await afterChange(ctx);
  }
};

// Kaufdaten: Formular öffnen und schließen über das Panel der Ansicht
const buyHandlers = purchaseHandlers({
  ctxHousehold: ctx => ctx.app.household,
  async onEdit(target, ctx) {
    const edit = document.querySelector('form[data-form="saveItem"]');
    if (edit && [...edit.querySelectorAll('input')].some(i => i.value !== i.defaultValue)) {
      toast('Erst die Änderung speichern oder abbrechen');
      return;
    }
    st.panel = target.box_id ? 'buy:box' : 'buy:' + target.item_id;
    clearShot();
    await ctx.rerender();
    (document.getElementById('itemBuy') ?? document.getElementById('buy'))?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  },
  async onDone(ctx) {
    st.panel = null;
    await ctx.rerender();
  }
});

// Karte für Kaufdaten: bei Einzelstücken immer, sonst nur, wenn schon ein Kauf am Ding hängt (z. B. nach Typwechsel)
function buyCardHtml(b) {
  const show = groupOf(b.type) === 'single' || purchaseOf({ box_id: b.id }) || st.panel === 'buy:box';
  return show ? buyHtml({ box_id: b.id }, b.name, st.panel === 'buy:box') : '';
}

// Kaufdaten laden und an den Platzhaltern einsetzen
async function fillBuy(boxId) {
  const items = st.current?.items ?? [];
  if (buyLoaded(boxId)) return;
  await fillPurchases(boxId, items.map(i => i.id));
  if (st.boxId !== boxId) return;
  const card = document.getElementById('buy');
  if (card) card.innerHTML = buyCardHtml(st.current);
  const form = document.getElementById('itemBuy');
  const it = items.find(i => i.id === form?.dataset.id);
  if (form && it) form.innerHTML = buyHtml({ item_id: it.id }, it.name, true);
  for (const i of items) {
    const slot = document.querySelector(`[data-buy="${i.id}"]`);
    if (slot) slot.outerHTML = buyBadgeHtml(i.id);
  }
}

function deniedHtml() {
  return `<div class="card empty">
    <div class="lock-ico">${icon('lock')}</div>
    <h2>Kein Zugriff</h2>
    <p class="muted">Dieses Etikett gehört nicht zu deinem Haushalt, ist gesperrt oder existiert nicht.</p>
    <a class="btn" href="#/scan">Zurück zum Scannen</a>
  </div>`;
}

// Erster Scan eines freien Etiketts: erst der Typ, dann Name, Ort und auf Wunsch gleich der Inhalt
const claimState = { code: null, type: null };

async function freeHtml(p, ctx) {
  if (claimState.code !== p.code) Object.assign(claimState, { code: p.code, type: p.kind === 'K' ? 'box' : p.kind === 'O' ? 'room' : null });
  const head = `<div class="claim-head"><span class="big-tag${p.kind === 'O' ? ' o' : ''}">${humanNumber(p.kind, p.number)}</span>
    <div><h2>${claimState.type ? `${esc(typeLabel(claimState.type))} anlegen` : 'Was ist das?'}</h2><p class="muted small">Dieses Etikett ist noch frei.</p></div></div>`;
  if (!claimState.type) {
    return `<div class="card stack">${head}${typeGrid('claimType', null)}
      <p class="muted small">Der Typ lässt sich später jederzeit ändern.</p>
      <a class="btn ghost" href="#/scan">Abbrechen</a></div>`;
  }
  st.things = await api.things(ctx.app.household);
  const tree = buildTree(st.things);
  const places = st.things.filter(t => canHold(t.type))
    .map(t => ({ ...t, path: tree.path(t.id) }))
    .sort((x, y) => `${x.path} ${x.name}`.localeCompare(`${y.path} ${y.name}`, 'de'));
  const moving = store.moving();
  const last = store.lastPlace();
  const stow = store.stow();
  const pre = moving ? null : places.find(x => x.id === (stow?.id ?? last?.id))?.id ?? null;
  const label = t => esc(t.path ? `${t.path} › ${t.name}` : t.name);
  return `<form class="card stack" data-form="claim" data-code="${p.code}">
    ${head}
    <button type="button" class="link-btn" data-act="claimType" data-v="">Typ ändern</button>
    <label class="field"><span>Name</span>
      <input class="input" id="claimName" maxlength="80" placeholder="${isPlace(claimState.type) ? 'z. B. Lastenregal' : 'z. B. Werkzeug Elektro'}"></label>
    <label class="field"><span>Wo ${canHold(claimState.type) && isPlace(claimState.type) ? 'ist es' : 'steht es'}?</span><select class="input" id="claimLoc">
      <option value="">Ganz oben, ohne Ort</option>
      ${places.map(t => `<option value="${t.id}"${t.id === pre ? ' selected' : ''}>${label(t)}</option>`).join('')}</select></label>
    ${pre ? `<p class="muted small">Vorgeschlagen: ${stow ? 'Ziel beim Einräumen' : 'zuletzt geöffnet'}.</p>` : ''}
    ${canHold(claimState.type) && !isPlace(claimState.type) ? `<label class="field"><span>Inhalt gleich erfassen (optional)</span>
      <textarea class="input" id="claimItems" rows="2" placeholder="Akkuschrauber, 2x Ladegerät"></textarea></label>` : ''}
    ${moving && canHold(claimState.type) ? `<p class="note">Danach kommt „${esc(moving.name)}“ hierhin.</p>` : ''}
    <div class="btn-row"><button class="btn primary" type="submit">Anlegen</button><a class="btn ghost" href="#/scan">Abbrechen</a></div>
  </form>`;
}

// ---------- Daten ----------

// Ding über die ID laden; dieselbe Form wie das Scan-Ergebnis
async function loadBox(id) {
  const r = await api.box(id);
  return r ? { status: 'box', ...r } : null;
}

// ---------- Fotos ----------

const addPhotoBtn = label => `<label class="btn photo-add">${icon('camera')} ${label}
  <input id="photoInput" type="file" accept="image/*" multiple hidden></label>`;

function photosHtml() {
  const list = st.photos;
  if (!list) return '<p class="muted small">Fotos laden …</p>';
  if (!list.length) return `<div class="card-head"><h3>Fotos</h3></div>${addPhotoBtn('Foto hinzufügen')}`;
  const sel = list[Math.min(st.photoSel, list.length - 1)];
  return `<div class="card-head"><h3>Fotos</h3><span class="muted small">${list.length} von ${MAX_PHOTOS}</span></div>
    <div class="photo-main"><img src="${esc(sel.url)}" alt="Foto der Kiste">
      <button class="icon-btn photo-del${st.photoArmed === sel.id ? ' armed' : ''}" data-act="photoDelete" data-id="${sel.id}"
        aria-label="${st.photoArmed === sel.id ? 'Wirklich löschen?' : 'Foto löschen'}">${st.photoArmed === sel.id ? 'Löschen?' : icon('trash')}</button></div>
    ${list.length > 1 || list.length < MAX_PHOTOS ? `<div class="photo-thumbs">
      ${list.map((p, i) => `<button class="photo-thumb${p.id === sel.id ? ' on' : ''}" data-act="photoSel" data-i="${i}" aria-label="Foto ${i + 1} zeigen">
        <img src="${esc(p.url)}" alt=""></button>`).join('')}
      ${list.length < MAX_PHOTOS ? `<label class="photo-thumb photo-plus" aria-label="Foto hinzufügen">${icon('plus')}
        <input id="photoInput" type="file" accept="image/*" multiple hidden></label>` : ''}
    </div>` : ''}`;
}

function paintPhotos() {
  const el = document.getElementById('photos');
  if (el) el.innerHTML = photosHtml();
}

async function fillPhotos(boxId) {
  if (st.photos && st.boxId === boxId) return paintPhotos();
  try {
    const list = await api.photos(boxId);
    if (st.boxId !== boxId) return;
    st.photos = list;
  } catch {
    st.photos = [];
  }
  paintPhotos();
}

const photoActions = {
  photoSel(el) {
    st.photoSel = Number(el.dataset.i);
    st.photoArmed = null;
    paintPhotos();
  },
  async photoDelete(el) {
    if (st.photoArmed !== el.dataset.id) { st.photoArmed = el.dataset.id; paintPhotos(); return; }
    const photo = st.photos.find(p => p.id === el.dataset.id);
    st.photoArmed = null;
    await api.deletePhoto(photo);
    st.photos = st.photos.filter(p => p.id !== photo.id);
    st.photoSel = Math.max(0, st.photoSel - 1);
    toast('Foto gelöscht');
    paintPhotos();
  }
};

const photoChange = {
  async photoInput(el, ctx) {
    const files = [...el.files].slice(0, MAX_PHOTOS - (st.photos?.length ?? 0));
    if (!files.length) { toast(errorText('photo_limit')); return; }
    const boxId = st.boxId;
    toast(files.length === 1 ? 'Foto wird hochgeladen …' : `${files.length} Fotos werden hochgeladen …`);
    try {
      for (const f of files) await api.addPhoto(ctx.app.household, boxId, await shrinkImage(f));
      st.photos = await api.photos(boxId);
      st.photoSel = st.photos.length - 1;
      toast(files.length === 1 ? 'Foto gespeichert' : 'Fotos gespeichert');
    } catch (e) {
      console.error(e);
      toast(errorText(e), 'error');
    }
    if (st.boxId === boxId) paintPhotos();
  }
};

// ---------- Foto pro Gegenstand (freigestellt mit Apples „Auswahl kopieren“) ----------

const picOf = id => st.itemPhotos?.get(id) ?? null;

function picBtnHtml(it) {
  if (!st.itemPhotos) return `<span class="item-pic" data-pic="${it.id}" aria-hidden="true"></span>`;
  const p = picOf(it.id);
  return p
    ? `<button class="item-pic" data-pic="${it.id}" data-act="panel" data-v="pic:${it.id}" aria-label="Foto von ${esc(it.name)} ansehen"><img src="${esc(p.url)}" alt=""></button>`
    : `<button class="item-pic empty" data-pic="${it.id}" data-act="panel" data-v="pic:${it.id}" aria-label="Foto für ${esc(it.name)} hinzufügen">${icon('camera')}</button>`;
}

const shotInput = label => `<label class="btn">${icon('camera')} ${label}<input id="itemShot" type="file" accept="image/*" hidden></label>`;
const pasteBtn = primary => `<button class="btn${primary ? ' primary' : ''}" data-act="picPaste">Freigestellt übernehmen</button>`;
const pasteField = `<div class="paste-field" id="picPasteField" contenteditable="true" role="textbox" aria-label="Freigestelltes Bild hier einfügen">Oder hier tippen, lange drücken, „Einfügen“</div>`;

function picPanelHtml(it) {
  const p = picOf(it.id);
  const head = `<div class="pic-head"><div class="grow"><div class="item-name">${esc(it.name)}</div>
      <div class="meta">${it.qty}× · Foto</div></div>
    <button class="icon-btn" data-act="panel" data-v="" aria-label="Schließen">${icon('close')}</button></div>`;
  const msg = st.picMsg ? `<p class="note">${esc(st.picMsg)}</p>` : '';
  if (st.shot) {
    return `${head}
      <img class="pic-shot" src="${esc(st.shot.url)}" alt="Aufgenommenes Foto von ${esc(it.name)}">
      <ol class="pic-steps"><li><strong>Lange auf den Gegenstand drücken</strong></li><li>„Auswahl kopieren“ wählen</li><li>„Freigestellt übernehmen“ tippen</li></ol>
      ${msg}${pasteBtn(true)}${pasteField}
      <div class="btn-row">${shotInput('Neu aufnehmen')}<button class="btn" data-act="picPlain">Ohne Freistellen</button></div>`;
  }
  if (p) {
    return `${head}
      <div class="pic-view"><img src="${esc(p.url)}" alt="Foto von ${esc(it.name)}"></div>
      ${msg}
      <div class="btn-row">${shotInput('Ersetzen')}
        <button class="btn${st.picArmed ? ' danger' : ''}" data-act="picDelete">${st.picArmed ? 'Wirklich entfernen?' : `${icon('trash')} Entfernen`}</button></div>`;
  }
  return `${head}
    <p class="muted small">Foto aufnehmen, dann lange auf den Gegenstand drücken und „Auswahl kopieren“ wählen. Schon in „Fotos“ kopiert? Dann direkt übernehmen.</p>
    ${msg}
    <div class="btn-row">${shotInput('Foto aufnehmen')}${pasteBtn(false)}</div>
    ${pasteField}`;
}

function clearShot() {
  if (st.shot) URL.revokeObjectURL(st.shot.url);
  st.shot = null;
  st.picArmed = false;
  st.picMsg = '';
}

function paintPic() {
  const el = document.getElementById('itemPic');
  const it = st.current?.items?.find(i => i.id === el?.dataset.id);
  if (!el || !it) return;
  el.innerHTML = picPanelHtml(it);
  wirePaste();
}

// Einfügen per langem Druck: das Feld nimmt nur Bilder an
function wirePaste() {
  const f = document.getElementById('picPasteField');
  if (!f || f.dataset.wired) return;
  f.dataset.wired = '1';
  f.addEventListener('focus', () => { f.textContent = ''; });
  f.addEventListener('paste', e => {
    e.preventDefault();
    const file = [...(e.clipboardData?.items ?? [])].find(i => i.type.startsWith('image/'))?.getAsFile();
    if (file) saveCutout(file);
    else { st.picMsg = 'Eingefügt, aber kein Bild gefunden.'; paintPic(); }
  });
}

async function fillItemPics(boxId) {
  try {
    const list = await api.itemPhotos(boxId);
    if (st.boxId !== boxId) return;
    st.itemPhotos = new Map(list.map(p => [p.item_id, p]));
  } catch {
    st.itemPhotos = new Map();
  }
  for (const it of st.current?.items ?? []) {
    const slot = document.querySelector(`[data-pic="${it.id}"]`);
    if (slot) slot.outerHTML = picBtnHtml(it);
  }
  if (st.panel?.startsWith('pic:')) paintPic();
}

let picCtx = null;
async function storePic(blob, cutout) {
  const itemId = st.panel?.slice(4);
  if (!itemId || !picCtx) return;
  toast('Foto wird gespeichert …');
  await api.setItemPhoto(picCtx.app.household, st.boxId, itemId, blob, cutout);
  clearShot();
  st.panel = null;
  st.itemPhotos = null;
  toast(cutout ? 'Freigestelltes Foto gespeichert' : 'Foto gespeichert');
  await picCtx.rerender();
}

async function saveCutout(blob) {
  try {
    const { blob: png, cutout } = await shrinkCutout(blob);
    await storePic(png, cutout);
  } catch (e) {
    console.error(e);
    toast(errorText(e), 'error');
  }
}

const picActions = {
  // Zwischenablage zuerst lesen: iOS erlaubt das nur direkt im Tipp
  async picPaste(_, ctx) {
    picCtx = ctx;
    let blob;
    try {
      blob = await clipboardImage();
    } catch {
      st.picMsg = errorText('clipboard_unavailable');
      paintPic();
      return;
    }
    if (!blob) { st.picMsg = errorText('clipboard_empty'); paintPic(); return; }
    await saveCutout(blob);
  },
  async picPlain(_, ctx) {
    picCtx = ctx;
    if (!st.shot) return;
    await storePic(await shrinkImage(st.shot.file, 1200), false);
  },
  async picDelete(_, ctx) {
    const p = picOf(st.panel?.slice(4));
    if (!p) return;
    if (!st.picArmed) { st.picArmed = true; paintPic(); return; }
    await api.deleteItemPhoto(p);
    clearShot();
    st.itemPhotos.delete(p.item_id);
    st.panel = null;
    toast('Foto entfernt');
    await ctx.rerender();
  }
};

const picChange = {
  itemShot(el, ctx) {
    picCtx = ctx;
    const file = el.files[0];
    if (!file) return;
    clearShot();
    st.shot = { file, url: URL.createObjectURL(file) };
    paintPic();
    document.getElementById('itemPic')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
};

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

// ---------- Ausleihen (Personen ohne App-Zugang; Erinnerung auf der Übersicht und als Kalendereintrag) ----------

const lendState = { boxId: null, list: null, people: null, armedReturn: false };
const dayText = s => (s ? s.split('-').reverse().join('.') : '');
const openLending = () => lendState.list?.find(l => !l.returned_at) ?? null;

function lendIcsFor(l, thingName) {
  const who = l.borrowers?.name ?? 'jemandem';
  return reminderIcs({
    uid: l.id ?? crypto.randomUUID(),
    date: l.remind_at,
    title: `${thingName} zurückholen (bei ${who})`,
    description: `Verliehen am ${fmtDay(l.lent_at ?? new Date().toISOString())} an ${who}.${l.note ? ' ' + l.note : ''} QRate`
  });
}

function lendHtml() {
  const b = st.current;
  if (!b || isPlace(b.type)) return '';
  if (!lendState.list) return '<p class="muted small">Ausleihen lädt …</p>';
  const open = openLending();
  const past = lendState.list.filter(l => l.returned_at);
  const history = past.length ? `<h4 class="sub">Ausleih-Verlauf</h4><ul class="lend-history">${past.map(l =>
    `<li><strong>${esc(l.borrowers?.name ?? 'Person gelöscht')}</strong> · ${fmtDay(l.lent_at)} bis ${fmtDay(l.returned_at)}</li>`).join('')}</ul>` : '';
  if (open) {
    const who = open.borrowers?.name ?? 'Person gelöscht';
    const phone = open.borrowers?.phone;
    const due = open.remind_at && open.remind_at <= inDays(0);
    const sms = phone ? `sms:${encodeURIComponent(phone.replace(/\s/g, ''))}&body=${encodeURIComponent(`Hallo ${who}, hast du noch „${b.name}“? Ich bräuchte es bald zurück.`)}` : '';
    return `<div class="card-head"><h3>Verliehen</h3>${due ? '<span class="pill warn">Erinnerung fällig</span>' : ''}</div>
      <div class="lent-bar">${icon('people')}<span><strong>An ${esc(who)}</strong> seit ${fmtDay(open.lent_at)}
        ${open.remind_at ? `<br>Erinnerung am ${dayText(open.remind_at)}` : ''}${open.note ? `<br>„${esc(open.note)}“` : ''}</span></div>
      <div class="btn-row">
        <button class="btn primary" data-act="lendReturn">${icon('undo')} Zurück erhalten</button>
        <button class="btn" data-act="lendLater">In 1 Monat erinnern</button>
        ${open.remind_at ? `<button class="btn" data-act="lendIcs">${icon('calendar')} Kalender</button>` : ''}
        ${sms ? `<a class="btn" href="${esc(sms)}">${icon('message')} Nachricht</a>` : ''}
      </div>${history}`;
  }
  if (st.panel !== 'lend') {
    return `<div class="card-head"><h3>Ausleihen</h3></div>
      <button class="btn" data-act="panel" data-v="lend">${icon('people')} Verleihen</button>${history}`;
  }
  const people = lendState.people ?? [];
  return `<form class="stack" data-form="lendForm">
    <div class="card-head"><h3>Verleihen</h3></div>
    <label class="field"><span>An wen?</span><select class="input" id="lendWho">
      <option value="">Neue Person …</option>
      ${people.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
    <div class="field-row" id="lendNew">
      <label class="field"><span>Name der neuen Person</span><input class="input" id="lendName" maxlength="80" autocomplete="off"></label>
      <label class="field"><span>Telefon (optional)</span><input class="input" id="lendPhone" type="tel" maxlength="40" autocomplete="off"></label>
    </div>
    <label class="field"><span>Erinnern am (leer = gar nicht)</span><input class="input" id="lendDate" type="date" value="${inDays(90)}"></label>
    <div class="btn-row">${[[14, '2 Wochen'], [30, '1 Monat'], [90, '3 Monate']].map(([d, t]) =>
      `<button type="button" class="btn small" data-act="lendIn" data-days="${d}">${t}</button>`).join('')}</div>
    <label class="field"><span>Notiz (optional)</span><input class="input" id="lendNote" maxlength="500" placeholder="z. B. mit 2 Akkus"></label>
    <label class="check"><input type="checkbox" id="lendCal" checked> Kalendereintrag mit Erinnerung herunterladen</label>
    <p class="muted small">Name und Telefon sehen nur Mitglieder deines Haushalts. Löschen kannst du Personen unter „Haushalt“.</p>
    <div class="btn-row"><button class="btn primary" type="submit">Verleihen</button>
      <button class="btn ghost" type="button" data-act="panel" data-v="">Abbrechen</button></div>
  </form>`;
}

function paintLending() {
  const el = document.getElementById('lending');
  if (el) el.innerHTML = lendHtml();
}

// Ein offenes Formular wird nicht überschrieben, solange nicht ausdrücklich neu gezeichnet werden soll
async function fillLending(ctx, boxId, force = false) {
  if (!document.getElementById('lending')) return;
  if (lendState.boxId !== boxId) Object.assign(lendState, { boxId, list: null, people: null });
  try {
    const [list, people] = await Promise.all([api.boxLendings(boxId), api.borrowers(ctx.app.household)]);
    if (st.boxId !== boxId) return;
    Object.assign(lendState, { list, people });
  } catch {
    lendState.list = [];
  }
  if (force || !document.querySelector('#lending form')) paintLending();
}

const lendActions = {
  lendIn(el) {
    const f = document.getElementById('lendDate');
    if (f) f.value = inDays(Number(el.dataset.days));
  },
  async lendReturn(_, ctx) {
    await api.returnLending(openLending().id);
    toast('Zurück erhalten');
    await fillLending(ctx, st.boxId, true);
  },
  async lendLater(_, ctx) {
    const date = inDays(30);
    await api.remindLater(openLending().id, date);
    toast(`Erinnerung am ${dayText(date)}`);
    await fillLending(ctx, st.boxId, true);
  },
  lendIcs() {
    downloadIcs(lendIcsFor(openLending(), st.current.name));
  }
};

async function lendForm(f, ctx) {
  let who = f.querySelector('#lendWho').value;
  let added = false;
  if (!who) {
    const name = f.querySelector('#lendName').value.trim();
    if (!name) { toast('Bitte eine Person wählen oder einen Namen eingeben'); return; }
    who = (await api.addBorrower(ctx.app.household, name, f.querySelector('#lendPhone').value.trim())).id;
    added = true;
  }
  const date = f.querySelector('#lendDate').value || null;
  const note = f.querySelector('#lendNote').value.trim() || null;
  try {
    await api.lend(st.boxId, who, date, note);
  } catch (e) {
    // Neu angelegte Person wieder entfernen, sonst entsteht bei jedem Versuch eine doppelte
    if (added) await api.deleteBorrower(who).catch(() => {});
    throw e;
  }
  st.panel = null;
  await fillLending(ctx, st.boxId, true);
  toast('Verliehen');
  if (date && f.querySelector('#lendCal').checked) downloadIcs(lendIcsFor(openLending(), st.current.name));
}

// ---------- Aktionen der Ansicht ----------

const boxActions = {
  async panel(el, ctx) {
    const v = el.dataset.v || null;
    st.panel = st.panel === v ? null : v;
    clearShot();
    if (st.panel === 'move') st.things = await api.things(ctx.app.household);
    await ctx.rerender();
    if (st.panel === 'add') document.getElementById('quick')?.focus();
  },
  async take(el, ctx) {
    const id = el.dataset.id;
    await api.removeItem(id);
    toast(`„${el.dataset.name}“ entnommen`, '', {
      label: 'Rückgängig',
      async run() {
        try {
          await api.restoreItem(id);
          await afterChange(ctx);
          toast('Zurückgelegt');
        } catch (e) { toast(errorText(e), 'error'); }
      }
    });
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
    store.setCheckRound(null);
    store.setMoving({ id: b.id, name: b.name });
    st.panel = null;
    ctx.go('scan');
  },
  async moveTo(el, ctx) {
    await api.moveBox(st.boxId, el.dataset.id || null);
    st.panel = null;
    toast(el.dataset.id ? 'Verschoben' : 'Ort entfernt');
    await afterChange(ctx);
  },
  async setType(el, ctx) {
    if (el.dataset.v === st.current.type) { st.panel = null; await ctx.rerender(); return; }
    await api.changeType(st.boxId, el.dataset.v);
    st.panel = null;
    toast(`Jetzt: ${typeLabel(el.dataset.v)}`);
    await afterChange(ctx);
  },
  claimType(el, ctx) {
    claimState.type = el.dataset.v || null;
    ctx.rerender();
  },
  stow(_, ctx) {
    store.setCheckRound(null);
    store.setStow({ id: st.current.id, name: st.current.name, done: [] });
    st.panel = null;
    ctx.go('scan');
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
  },
  claim,
  lendForm
};

const boxInput = {
  quick(el) {
    const list = parseQuick(el.value);
    const out = document.getElementById('quickPreview');
    if (out) out.textContent = list.length ? list.map(x => `${x.qty}× ${x.name}`).join(' · ') : '';
  }
};

let ctxRef = null; // für Darstellungen, die den Haushalt brauchen (Prüfrunde)
function showBox(ctx, p, opts) {
  ctxRef = ctx;
  resetFor(p.box.id);
  st.current = { ...p.box, items: p.items };
  st.childCount = p.children?.length ?? 0;
  st.itemCount = p.items.length;
  // Was etwas aufnehmen kann, wird beim nächsten Anlegen als Ort vorgeschlagen
  if (canHold(p.box.type)) store.setLastPlace({ id: p.box.id, name: p.box.name });
  ctx.setTitle(typeLabel(p.box.type), ctx.app.membership.households?.name ?? '', true);
  return boxHtml(p, opts);
}

// Nach dem Zeichnen: Gegenstandsfotos laden oder vorhandene einsetzen, Einfügen-Feld verdrahten
function afterPaint() {
  if (st.itemPhotos === null) fillItemPics(st.boxId);
  fillBuy(st.boxId);
  wirePaste();
}

// Ein Ding wird gerade verschoben und das Ziel wurde gescannt
async function finishMove(ctx, target) {
  const moving = store.moving();
  store.setMoving(null);
  if (!canHold(target.type)) { toast(`In „${target.name}“ kann nichts hinein`, 'error'); return false; }
  await api.moveBox(moving.id, target.id);
  toast(`„${moving.name}“ ist jetzt in ${target.name}`);
  ctx.go('box/' + moving.id);
  return true;
}

// ---------- Seiten ----------

export const resolveView = {
  id: 'box',
  tab: 'scan',
  async render(ctx, code) {
    st.code = code;
    const cached = store.cached(code);
    if (cached?.data?.status === 'box' && !store.moving()) ctx.paint(showBox(ctx, cached.data, { cachedAt: cached.at }));
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
    await ctx.useHousehold(p.box?.household_id ?? p.household_id);
    if (p.status === 'free') {
      ctx.setTitle(humanNumber(p.kind, p.number), 'Freies Etikett', true);
      return freeHtml(p, ctx);
    }
    // Verschieben und Einräumen nur bei einem echten Scan, nicht beim Öffnen über Liste oder Link
    const scanned = ctx.fromScan(code);
    const moving = store.moving();
    if (scanned && moving && moving.id !== p.box.id && await finishMove(ctx, p.box)) return;
    if (scanned && store.stow()) { await stowScanned(ctx, p.box); return; }
    store.cache(code, p);
    return showBox(ctx, p);
  },
  leave() { resetBuy(null); },
  mounted(ctx) {
    picCtx = ctx; // auch Einfügen ins Feld ohne vorherigen Knopf speichert
    if (st.current && document.getElementById('events')) fillEvents(ctx, st.current.id);
    if (st.current && document.getElementById('photos')) { fillPhotos(st.current.id); afterPaint(); fillLending(ctx, st.current.id); }
  },
  actions: { ...boxActions, ...photoActions, ...picActions, ...lendActions, ...checkActions, ...buyHandlers.actions },
  forms: { ...boxForms, ...buyHandlers.forms },
  input: boxInput,
  change: { ...photoChange, ...picChange, ...buyHandlers.change }
};

export const boxView = {
  id: 'box',
  tab: 'home',
  async render(ctx, id) {
    const p = await loadBox(id);
    if (!p) { ctx.setTitle('Kein Zugriff', '', true); return deniedHtml(); }
    await ctx.useHousehold(p.box.household_id);
    st.code = p.box.code;
    return showBox(ctx, p);
  },
  leave() { resetBuy(null); },
  mounted(ctx, id) { picCtx = ctx; fillEvents(ctx, id); fillPhotos(id); afterPaint(); fillLending(ctx, id); },
  actions: { ...boxActions, ...photoActions, ...picActions, ...lendActions, ...checkActions, ...buyHandlers.actions },
  forms: { ...boxForms, ...buyHandlers.forms },
  input: boxInput,
  change: { ...photoChange, ...picChange, ...buyHandlers.change }
};

// ---------- Etikett zuordnen ----------

async function claim(f, ctx) {
  const code = f.dataset.code;
  const type = claimState.type;
  const name = f.querySelector('#claimName').value.trim();
  const parent = f.querySelector('#claimLoc')?.value || null;
  const items = parseQuick(f.querySelector('#claimItems')?.value ?? '');
  const res = await api.claim(code, name, type, parent);
  claimState.code = null;
  if (items.length) {
    // Das Ding existiert schon; scheitern nur die Gegenstände, trotzdem hin und Fehler zeigen
    try { await api.addItems(res.id, items); }
    catch (e) { toast(`Angelegt, aber Inhalt nicht gespeichert: ${errorText(e)}`, 'error'); ctx.go('box/' + res.id); return; }
  }
  const moving = store.moving();
  if (moving && canHold(type)) {
    store.setMoving(null);
    await api.moveBox(moving.id, res.id);
    toast(`Angelegt, „${moving.name}“ ist jetzt dort`);
    ctx.go('box/' + moving.id);
    return;
  }
  const stow = store.stow();
  if (stow) {
    stow.done.unshift({ name: name || typeLabel(type), from: null });
    store.setStow(stow);
    toast(`${typeLabel(type)} angelegt und eingeräumt`);
    ctx.go('scan');
    return;
  }
  toast(`${typeLabel(type)} angelegt`);
  ctx.go('box/' + res.id);
}

// Einräumen: jedes gescannte Ding kommt ins Ziel, danach geht es direkt zurück zum Scannen
async function stowScanned(ctx, thing) {
  const stow = store.stow();
  if (thing.id === stow.id) {
    toast('Das ist das Ziel selbst');
  } else {
    try {
      await api.moveBox(thing.id, stow.id);
      stow.done.unshift({ name: thing.name, from: thing.parent?.name ?? null });
      store.setStow(stow);
      toast(`„${thing.name}“ eingeräumt`);
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }
  ctx.go('scan');
}
