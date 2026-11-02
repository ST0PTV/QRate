// Übersicht: Kennzahlen, Kisten nach Ort, letzte Änderungen.
import { overview } from '../core/api.js';
import { esc, icon, tag, fmtTime, eventText } from '../core/ui.js';

export function boxRow(b) {
  const n = b.items?.[0]?.count ?? b.item_count ?? 0;
  return `<a class="row-link" href="#/box/${b.id}">
    ${tag('K', b.labels?.number ?? b.number)}
    <span class="grow"><span class="row-title">${esc(b.name)}</span></span>
    <span class="count">${n}</span>
  </a>`;
}

const byNumber = (a, b) => (a.labels?.number ?? 1e9) - (b.labels?.number ?? 1e9);

export default {
  id: 'home',
  tab: 'home',
  async render(ctx) {
    const { app } = ctx;
    ctx.setTitle(app.membership.households?.name ?? 'Haushalt', `Angemeldet als ${app.membership.display_name}`);
    const { boxes, locations, freeLabels, events } = await overview(app.household);
    const items = boxes.reduce((s, b) => s + (b.items?.[0]?.count ?? 0), 0);

    if (!boxes.length) {
      return `<div class="card stack">
        <h2>So geht es los</h2>
        <ol class="steps">
          <li><strong>Etiketten drucken:</strong> Unter „Etiketten“ einen Bogen reservieren und drucken.</li>
          <li><strong>Aufkleben:</strong> Ein Etikett pro Kiste, Orts-Etiketten an Regale oder Schränke.</li>
          <li><strong>Scannen:</strong> Beim ersten Scan legst du die Kiste an und erfasst den Inhalt.</li>
        </ol>
        <div class="btn-row">
          <a class="btn primary" href="#/etiketten">${icon('label')} Etiketten</a>
          <a class="btn" href="#/scan">${icon('scan')} Scannen</a>
        </div>
      </div>`;
    }

    const groups = new Map(locations.map(l => [l.id, { loc: l, boxes: [] }]));
    const loose = [];
    for (const b of boxes) (groups.get(b.location_id)?.boxes ?? loose).push(b);

    const group = (title, tagHtml, list, href) => `<section class="card">
      <a class="group-head" ${href ? `href="${href}"` : ''}>${tagHtml}<h3>${esc(title)}</h3><span class="muted small">${list.length} ${list.length === 1 ? 'Kiste' : 'Kisten'}</span></a>
      ${list.sort(byNumber).map(boxRow).join('')}
    </section>`;

    return `
      <div class="stats">
        <div class="stat"><span class="stat-n">${boxes.length}</span><span class="muted">Kisten</span></div>
        <div class="stat"><span class="stat-n">${items}</span><span class="muted">Gegenstände</span></div>
        <a class="stat" href="#/etiketten"><span class="stat-n">${freeLabels}</span><span class="muted">freie Etiketten</span></a>
      </div>
      <a class="btn primary wide" href="#/scan">${icon('scan')} Etikett scannen</a>
      ${[...groups.values()].filter(g => g.boxes.length)
        .map(g => group(g.loc.name, tag('O', g.loc.labels?.number), g.boxes, `#/loc/${g.loc.id}`)).join('')}
      ${loose.length ? group('Ohne Ort', '', loose) : ''}
      ${events.length ? `<section class="card"><h3 class="card-title">Zuletzt</h3><ul class="events">${events.map(e => `<li>
        <time>${fmtTime(e.at)}</time>
        <a href="#/box/${e.box_id}"><strong>${esc(app.name(e.actor_id))}</strong> ${eventText(e)}</a></li>`).join('')}</ul></section>` : ''}`;
  }
};
