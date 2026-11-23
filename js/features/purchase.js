// Kauf und Garantie für ein Einzelstück oder einen Gegenstand: Datum, Preis, Händler, Seriennummer, Garantieende, Beleg.
// Ein Eintrag pro Ding oder Gegenstand. Belegfotos liegen privat im Bucket und zählen zur Speichergrenze.
import * as api from '../core/api.js';
import { esc, icon, toast } from '../core/ui.js';
import { errorText } from '../core/errors.js';
import { shrinkImage } from '../core/photo.js';
import { reminderIcs, downloadIcs, inDays } from '../core/ics.js';
import { dayText, parsePrice, priceText, plusYears, warrantyState } from '../core/warranty.js';


// Geladene Käufe der offenen Ansicht; Schlüssel 'box' oder die ID des Gegenstands
const buy = { boxId: null, map: null, receipt: null, dropReceipt: false, armed: false };

const euro = n => Number(n).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const keyOf = target => target.box_id ? 'box' : target.item_id;
const targetOf = el => JSON.parse(el.dataset.target);
// Neuen Beleg setzen oder verwerfen; die alte Vorschau-Adresse wird freigegeben
function setReceipt(r) {
  if (buy.receipt) URL.revokeObjectURL(buy.receipt.url);
  buy.receipt = r;
}

export function resetBuy(boxId) {
  if (buy.boxId === boxId) return;
  dropPending();
  Object.assign(buy, { boxId, map: null, armed: false });
}
function dropPending() {
  setReceipt(null);
  buy.dropReceipt = false;
}

// Schon geladen? Dann zeichnet die Ansicht direkt mit den Daten und lädt nicht erneut (offene Formulare bleiben).
export const buyLoaded = boxId => buy.boxId === boxId && buy.map !== null;
export const purchaseOf = target => buy.map?.get(keyOf(target)) ?? null;

export async function fillPurchases(boxId, itemIds) {
  try {
    const list = await api.purchasesFor(boxId, itemIds);
    if (buy.boxId !== boxId) return;
    buy.map = new Map(list.map(p => [keyOf(p), p]));
  } catch {
    if (buy.boxId === boxId) buy.map = new Map();
  }
}

// Kurzer Hinweis an einem Gegenstand, z. B. „Garantie bis 01.03.2027“
export function buyBadgeHtml(itemId) {
  const p = buy.map?.get(itemId);
  if (!p) return `<span class="buy-badge" data-buy="${itemId}"></span>`;
  const w = warrantyState(p.warranty_until);
  const text = p.warranty_until ? (w === 'over' ? 'Garantie abgelaufen' : `Garantie bis ${dayText(p.warranty_until)}`) : 'Kaufdaten';
  return `<span class="buy-badge${w === 'soon' ? ' warn' : ''}" data-buy="${itemId}">${icon('receipt', 'inline')}${text}</span>`;
}

function summaryHtml(p) {
  const w = warrantyState(p.warranty_until);
  const bought = [p.bought_on ? `Gekauft am ${dayText(p.bought_on)}` : '', p.price != null ? euro(p.price) : '', p.shop ? esc(p.shop) : '']
    .filter(Boolean).join(' · ');
  return `<dl class="buy-facts">
      ${bought ? `<div><dt>Kauf</dt><dd>${bought}</dd></div>` : ''}
      ${p.serial ? `<div><dt>Seriennummer</dt><dd class="mono">${esc(p.serial)}</dd></div>` : ''}
      ${p.warranty_until ? `<div><dt>Garantie</dt><dd>bis ${dayText(p.warranty_until)}
        ${w === 'over' ? ' <span class="pill">abgelaufen</span>' : w === 'soon' ? ' <span class="pill warn">endet bald</span>' : ''}</dd></div>` : ''}
    </dl>
    ${p.receipt_url ? `<a class="receipt-thumb" href="${esc(p.receipt_url)}" target="_blank" rel="noopener"><img src="${esc(p.receipt_url)}" alt="Beleg"></a>` : ''}`;
}

// Ansicht: Zusammenfassung mit Knöpfen oder das Formular. target = { box_id } oder { item_id }.
export function buyHtml(target, name, editing) {
  if (!buy.map) return '<p class="muted small">Kaufdaten laden …</p>';
  const p = purchaseOf(target);
  const t = esc(JSON.stringify(target));
  if (!editing) {
    if (!p) return `<div class="card-head"><h3>Kauf und Garantie</h3></div>
      <p class="muted small">Kaufdatum, Preis, Seriennummer und Beleg, z. B. für Garantie oder Versicherung.</p>
      <button class="btn" data-act="buyEdit" data-target="${t}">${icon('receipt')} Kaufdaten erfassen</button>`;
    return `<div class="card-head"><h3>Kauf und Garantie</h3></div>
      ${summaryHtml(p)}
      <div class="btn-row">
        <button class="btn" data-act="buyEdit" data-target="${t}">${icon('edit')} Bearbeiten</button>
        ${p.warranty_until && warrantyState(p.warranty_until) !== 'over'
          ? `<button class="btn" data-act="buyIcs" data-target="${t}" data-name="${esc(name)}">${icon('calendar')} Kalender</button>` : ''}
      </div>`;
  }
  const v = p ?? {};
  const hasReceipt = buy.receipt || (v.receipt_url && !buy.dropReceipt);
  return `<form class="stack" data-form="buyForm" data-target="${t}">
    <div class="card-head"><h3>Kauf und Garantie</h3><span class="muted small">${esc(name)}</span></div>
    <div class="field-row">
      <label class="field"><span>Gekauft am</span><input class="input" id="buyDate" type="date" value="${esc(v.bought_on)}"></label>
      <label class="field"><span>Preis in €</span><input class="input" id="buyPrice" inputmode="decimal" autocomplete="off"
        placeholder="z. B. 249,90" value="${v.price != null ? esc(priceText(v.price)) : ''}"></label>
    </div>
    <label class="field"><span>Händler</span><input class="input" id="buyShop" maxlength="80" autocomplete="off" value="${esc(v.shop)}"></label>
    <label class="field"><span>Seriennummer</span><input class="input mono" id="buySerial" maxlength="80" autocomplete="off"
      autocapitalize="characters" value="${esc(v.serial)}"></label>
    <label class="field"><span>Garantie bis</span><input class="input" id="buyWarranty" type="date" value="${esc(v.warranty_until)}"></label>
    <div class="btn-row">${[2, 3, 5].map(y => `<button type="button" class="btn small" data-act="buyYears" data-years="${y}">${y} Jahre ab Kauf</button>`).join('')}</div>
    <div class="field"><span>Beleg</span>
      <div id="buyReceiptPreview">${receiptPreviewHtml(v)}</div>
      <div class="btn-row">
        <label class="btn">${icon('camera')} ${hasReceipt ? 'Beleg ersetzen' : 'Beleg fotografieren'}<input id="buyReceipt" type="file" accept="image/*" hidden></label>
        ${hasReceipt ? `<button type="button" class="btn ghost" data-act="buyDropReceipt">Beleg entfernen</button>` : ''}
      </div>
    </div>
    <div class="btn-row"><button class="btn primary" type="submit">Speichern</button>
      <button class="btn ghost" type="button" data-act="buyCancel">Abbrechen</button>
      ${p ? `<button class="btn ghost${buy.armed ? ' danger' : ''}" type="button" data-act="buyDelete">${buy.armed ? 'Wirklich löschen?' : 'Löschen'}</button>` : ''}</div>
  </form>`;
}

function receiptPreviewHtml(v) {
  if (buy.receipt) return `<img class="receipt-thumb" src="${esc(buy.receipt.url)}" alt="Neuer Beleg">`;
  if (v.receipt_url && !buy.dropReceipt) return `<img class="receipt-thumb" src="${esc(v.receipt_url)}" alt="Beleg">`;
  return buy.dropReceipt ? '<p class="muted small">Beleg wird beim Speichern entfernt.</p>' : '';
}
function paintPreview() {
  const form = document.querySelector('form[data-form="buyForm"]');
  const el = document.getElementById('buyReceiptPreview');
  if (!form || !el) return;
  el.innerHTML = receiptPreviewHtml(purchaseOf(targetOf(form)) ?? {});
}

// Erinnerung einen Monat vor Garantieende, frühestens heute
function warrantyIcs(p, name) {
  const before = inDays(-30, new Date(p.warranty_until + 'T12:00'));
  const remind = before > inDays(0) ? before : inDays(0);
  return reminderIcs({
    uid: 'garantie-' + p.id,
    date: remind,
    title: `Garantie endet am ${dayText(p.warranty_until)}: ${name}`,
    description: `${name}${p.serial ? `, Seriennummer ${p.serial}` : ''}${p.shop ? `, gekauft bei ${p.shop}` : ''}. QRate`
  });
}

// Handler; onDone zeichnet die Ansicht neu (schließt das Formular)
export function purchaseHandlers({ onEdit, onDone }) {
  return {
    actions: {
      buyEdit(el, ctx) { dropPending(); buy.armed = false; return onEdit(targetOf(el), ctx); },
      buyCancel(_, ctx) { dropPending(); buy.armed = false; return onDone(ctx); },
      buyYears(el) {
        const from = document.getElementById('buyDate')?.value;
        if (!from) { toast('Erst das Kaufdatum eintragen'); return; }
        document.getElementById('buyWarranty').value = plusYears(from, Number(el.dataset.years));
      },
      buyDropReceipt() {
        setReceipt(null);
        buy.dropReceipt = true;
        paintPreview();
      },
      buyIcs(el) {
        const p = purchaseOf(targetOf(el));
        if (p?.warranty_until) downloadIcs(warrantyIcs(p, el.dataset.name), 'qrate-garantie.ics');
      },
      async buyDelete(el, ctx) {
        const target = targetOf(el.closest('form'));
        const p = purchaseOf(target);
        if (!p) return;
        if (!buy.armed) { buy.armed = true; el.classList.add('danger'); el.textContent = 'Wirklich löschen?'; return; }
        buy.armed = false;
        await api.deletePurchase(p.id);
        if (p.receipt_path) await api.dropFile(p.receipt_path).catch(() => {});
        buy.map.delete(keyOf(target));
        dropPending();
        toast('Kaufdaten gelöscht');
        await onDone(ctx);
      }
    },
    change: {
      async buyReceipt(el) {
        const f = el.files[0];
        if (!f) return;
        try {
          const blob = await shrinkImage(f, 1600, 0.75);
          setReceipt({ blob, url: URL.createObjectURL(blob) });
          buy.dropReceipt = false;
          paintPreview();
        } catch (e) {
          toast(errorText(e), 'error');
        }
      }
    },
    forms: {
      async buyForm(f, ctx) {
        const target = targetOf(f);
        const old = purchaseOf(target);
        const price = parsePrice(f.querySelector('#buyPrice').value);
        if (Number.isNaN(price)) { toast('Preis bitte als Zahl, z. B. 249,90', 'error'); return; }
        const fields = {
          bought_on: f.querySelector('#buyDate').value || null,
          price,
          shop: f.querySelector('#buyShop').value.trim() || null,
          serial: f.querySelector('#buySerial').value.trim() || null,
          warranty_until: f.querySelector('#buyWarranty').value || null
        };
        if (fields.bought_on && fields.warranty_until && fields.warranty_until < fields.bought_on) {
          toast('Garantieende liegt vor dem Kaufdatum', 'error');
          return;
        }
        const keepReceipt = old?.receipt_path && !buy.dropReceipt && !buy.receipt;
        if (!old && !buy.receipt && Object.values(fields).every(x => x == null)) {
          toast('Bitte mindestens ein Feld ausfüllen');
          return;
        }
        let newPath = null;
        if (buy.receipt) {
          toast('Beleg wird hochgeladen …');
          newPath = await api.uploadReceipt(ctx.app.household, buy.receipt.blob);
        }
        fields.receipt_path = newPath ?? (keepReceipt ? old.receipt_path : null);
        try {
          await api.savePurchase(old?.id ?? null, target, fields);
        } catch (e) {
          if (newPath) await api.dropFile(newPath).catch(() => {});
          throw e;
        }
        // Alten Beleg erst nach dem Speichern entfernen
        if (old?.receipt_path && old.receipt_path !== fields.receipt_path) await api.dropFile(old.receipt_path).catch(() => {});
        dropPending();
        buy.map = null; // neu laden, mit frischer Adresse für den Beleg
        toast('Kaufdaten gespeichert');
        await onDone(ctx);
      }
    }
  };
}
