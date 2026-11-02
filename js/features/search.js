// Suche über Gegenstände und Kistennamen (Datenbankfunktion search, tippfehlertolerant).
import { search } from '../core/api.js';
import { esc, tag } from '../core/ui.js';

let term = '';
let timer = null;
let seq = 0;

function resultsHtml(rows) {
  if (!term.trim()) return '<p class="muted small">Sucht in Gegenständen und Kistennamen. Tippfehler sind erlaubt.</p>';
  if (!rows.length) return `<p class="muted">Nichts gefunden für „${esc(term)}“.</p>`;
  return `<section class="card">${rows.map(r => `<a class="row-link" href="#/box/${r.box_id}">
    ${tag('K', r.box_number)}
    <span class="grow">
      <span class="row-title">${r.kind === 'item' ? `${r.qty}× ${esc(r.item_name)}` : esc(r.box_name)}</span>
      <span class="row-sub">${r.kind === 'item' ? esc(r.box_name) + ' · ' : 'Kiste · '}${esc(r.location_name ?? 'ohne Ort')}</span>
    </span></a>`).join('')}</section>`;
}

async function run(ctx) {
  const mine = ++seq;
  const el = document.getElementById('results');
  const rows = term.trim() ? await search(ctx.app.household, term.trim()) : [];
  if (mine === seq && el?.isConnected) el.innerHTML = resultsHtml(rows);
}

export default {
  id: 'search',
  tab: 'search',
  render(ctx) {
    ctx.setTitle('Suche', 'Wo ist …?');
    return `<input class="input search" id="q" type="search" placeholder="z. B. hdmi, stirnlampe, kugeln" value="${esc(term)}" autocomplete="off" aria-label="Suche">
      <div id="results">${term.trim() ? '<p class="muted small">Sucht …</p>' : resultsHtml([])}</div>`;
  },
  mounted(ctx) {
    const q = document.getElementById('q');
    q.focus();
    if (term.trim()) run(ctx).catch(() => {});
  },
  input: {
    q(el, ctx) {
      term = el.value;
      clearTimeout(timer);
      timer = setTimeout(() => run(ctx).catch(() => {}), 160);
    }
  }
};
