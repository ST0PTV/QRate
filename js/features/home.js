// Übersicht: Kennzahlen, Verliehen, Garantie endet bald, Prüfen, alles als Baum, gerade entnommen, letzte Änderungen.
import { overview, restoreItem, openLendings, returnLending, warrantiesUntil } from '../core/api.js';
import { startRound } from './check-round.js';
import { dayText } from '../core/warranty.js';
import { inDays } from '../core/ics.js';
import { esc, icon, fmtDay, fmtTime, eventText, toast } from '../core/ui.js';
import { typeLabel, typeIcon, isPlace, canHold, buildTree } from '../core/types.js';

// Baum: Räume, Regale, Kisten … zum Auf- und Zuklappen. Die obersten zwei Ebenen sind anfangs offen.
const open = new Set();
const closed = new Set();
const OPEN_DEPTH = 1;
const isOpen = (id, depth) => (depth <= OPEN_DEPTH ? !closed.has(id) : open.has(id));

function treeRows(tree, list, depth) {
  return list
    .sort((a, b) => (isPlace(b.type) - isPlace(a.type)) || a.name.localeCompare(b.name, 'de'))
    .map(t => {
      const kids = tree.children(t.id);
      const n = t.items?.[0]?.count ?? 0;
      const parts = [typeLabel(t.type)];
      if (kids.length) parts.push(`${kids.length} darin`);
      if (n) parts.push(n === 1 ? '1 Gegenstand' : `${n} Gegenstände`);
      const expanded = kids.length && isOpen(t.id, depth);
      return `<div class="tree-row" style="--depth:${depth}">
          ${kids.length ? `<button class="tree-toggle" data-act="toggle" data-id="${t.id}" data-depth="${depth}" aria-expanded="${Boolean(expanded)}"
            aria-label="${esc(t.name)} ${expanded ? 'zuklappen' : 'aufklappen'}">${icon(expanded ? 'down' : 'chevron')}</button>` : '<span class="tree-toggle" aria-hidden="true"></span>'}
          <a class="row-link grow" href="#/box/${t.id}"><span class="row-ico">${icon(typeIcon(t.type))}</span>
            <span class="grow"><span class="row-title">${esc(t.name)}</span><span class="row-sub">${esc(parts.join(' · '))}</span></span></a>
        </div>${expanded ? treeRows(tree, [...kids], depth + 1) : ''}`;
    }).join('');
}

export default {
  id: 'home',
  tab: 'home',
  async render(ctx) {
    const { app } = ctx;
    ctx.setTitle(app.membership.households?.name ?? 'Haushalt', `Angemeldet als ${app.membership.display_name}`);
    const today = inDays(0);
    const [{ boxes, freeLabels, events, taken = [] }, lent, soon] = await Promise.all([overview(app.household),
      openLendings(app.household).catch(() => []), warrantiesUntil(app.household, today, inDays(60)).catch(() => [])]);
    const items = boxes.reduce((s, b) => s + (b.items?.[0]?.count ?? 0), 0);

    if (!boxes.length) {
      return `<div class="card stack">
        <h2>So geht es los</h2>
        <ol class="steps">
          <li><strong>Etiketten drucken:</strong> Unter „Etiketten“ einen Bogen reservieren und drucken.</li>
          <li><strong>Aufkleben:</strong> An Kisten, Regale, Schränke oder einzelne Geräte. Alle Etiketten sind gleich.</li>
          <li><strong>Scannen:</strong> Beim ersten Scan wählst du, was es ist, und erfasst den Inhalt.</li>
        </ol>
        <div class="btn-row">
          <a class="btn primary" href="#/etiketten">${icon('label')} Etiketten</a>
          <a class="btn" href="#/scan">${icon('scan')} Scannen</a>
        </div>
      </div>`;
    }

    const tree = buildTree(boxes);
    const containers = boxes.filter(b => canHold(b.type) && !isPlace(b.type)).length;

    return `
      <p class="summary">${containers} Behälter · ${items === 1 ? '1 Gegenstand' : `${items} Gegenstände`} · <a href="#/etiketten">${freeLabels === 1 ? '1 freies Etikett' : `${freeLabels} freie Etiketten`}</a></p>
      ${lent.length ? `<section class="card lent">
        <div class="card-head"><h3>Verliehen</h3><span class="muted small">${lent.length}</span></div>
        ${lent.map(l => {
          const due = l.remind_at && l.remind_at <= today;
          return `<div class="taken-row lend-row${due ? ' due' : ''}">
            <a class="grow" href="#/box/${l.box_id}"><span class="row-title">${esc(l.boxes?.name ?? 'Ding')}</span>
              <span class="row-sub">bei ${esc(l.borrowers?.name ?? 'Person gelöscht')} · seit ${fmtDay(l.lent_at)}${due ? ' · Erinnerung fällig' : ''}</span></a>
            ${due ? `<button class="btn small" data-act="returned" data-id="${l.id}">Zurück</button>` : ''}
          </div>`;
        }).join('')}
      </section>` : ''}
      ${warrantyCard(soon)}
      ${checkCard(boxes)}
      ${taken.length ? `<section class="card taken">
        <div class="card-head"><h3>Gerade entnommen</h3><span class="muted small">${taken.length}</span></div>
        ${taken.map(t => `<div class="taken-row">
          <span class="qty">${t.qty}×</span>
          <a class="grow" href="#/box/${t.box_id}"><span class="row-title">${esc(t.name)}</span>
            <span class="row-sub">aus ${esc(t.boxes?.name ?? 'Kiste')} · ${esc(app.name(t.removed_by))}, ${fmtTime(t.removed_at)}</span></a>
          <button class="icon-btn small-ico" data-act="restore" data-id="${t.id}" aria-label="„${esc(t.name)}“ zurücklegen">${icon('undo')}</button>
        </div>`).join('')}
      </section>` : ''}
      <section class="card tree"><div class="card-head"><h3>Alles</h3><span class="muted small">${boxes.length}</span></div>
        ${treeRows(tree, [...tree.roots], 0)}</section>
      ${events.length ? `<section class="card"><h3 class="card-title">Zuletzt</h3><ul class="events">${events.map(e => `<li>
        <time>${fmtTime(e.at)}</time>
        <a href="#/box/${e.box_id}"><strong>${esc(app.name(e.actor_id))}</strong> ${eventText(e)}</a></li>`).join('')}</ul></section>` : ''}`;
  },
  actions: {
    toggle(el, ctx) {
      const id = el.dataset.id;
      const set = Number(el.dataset.depth) <= OPEN_DEPTH ? closed : open;
      if (set.has(id)) set.delete(id); else set.add(id);
      ctx.rerender();
    },
    startCheck(_, ctx) {
      startRound(ctx.app.household);
      ctx.go('scan');
    },
    async returned(el, ctx) {
      await returnLending(el.dataset.id);
      toast('Zurück erhalten');
      await ctx.rerender();
    },
    async restore(el, ctx) {
      await restoreItem(el.dataset.id);
      toast('Zurückgelegt.');
      await ctx.rerender();
    }
  }
};

// Garantie endet in den nächsten 60 Tagen (entnommene Gegenstände nicht)
function warrantyCard(list) {
  const rows = list.filter(w => !w.items?.removed_at && (w.boxes || w.items));
  if (!rows.length) return '';
  return `<section class="card"><div class="card-head"><h3>Garantie endet bald</h3><span class="muted small">${rows.length}</span></div>
    ${rows.map(w => `<a class="row-link" href="#/box/${w.box_id ?? w.items.box_id}">
      <span class="row-ico">${icon('receipt')}</span>
      <span class="grow"><span class="row-title">${esc(w.boxes?.name ?? w.items.name)}</span>
        <span class="row-sub">Garantie bis ${dayText(w.warranty_until)}</span></span></a>`).join('')}
  </section>`;
}

// Prüfen: Behälter, die am längsten nicht durchgesehen wurden. Orte und Einzelstücke zählen nicht.
const CHECK_OLD_DAYS = 180;
function checkCard(boxes) {
  const list = boxes.filter(b => canHold(b.type) && !isPlace(b.type));
  if (!list.length) return '';
  const old = new Date(Date.now() - CHECK_OLD_DAYS * 864e5).toISOString();
  const due = list.filter(b => !b.checked_at || b.checked_at < old)
    .sort((a, b) => (a.checked_at ?? '').localeCompare(b.checked_at ?? '') || a.name.localeCompare(b.name, 'de'));
  const never = list.filter(b => !b.checked_at).length;
  const sub = !due.length ? 'Alle Behälter im letzten halben Jahr geprüft.'
    : never === list.length ? 'Noch nichts geprüft. Eine Prüfrunde hält die Liste aktuell.'
    : `${due.length} Behälter länger als ein halbes Jahr nicht geprüft.`;
  const showList = due.length && never < list.length;
  return `<section class="card stack"><div class="card-head"><h3>Prüfen</h3></div>
    <p class="muted small">${sub}</p>
    ${showList ? due.slice(0, 3).map(b => `<a class="row-link" href="#/box/${b.id}"><span class="row-ico">${icon(typeIcon(b.type))}</span>
      <span class="grow"><span class="row-title">${esc(b.name)}</span>
        <span class="row-sub">${b.checked_at ? `zuletzt am ${fmtDay(b.checked_at)}` : 'noch nie geprüft'}</span></span></a>`).join('') : ''}
    <button class="btn" data-act="startCheck">${icon('shield')} Prüfrunde starten</button>
  </section>`;
}
