// Etiketten: reservieren, Übersicht, sperren und als A4-Bogen drucken (70 × 37 mm, 3 × 8 = 24 pro Seite).
import { CONFIG } from '../core/config.js';
import { labels, reserveLabels, blockLabel } from '../core/api.js';
import { humanNumber, labelUrl } from '../core/code.js';
import { icon, qrSvg, toast } from '../core/ui.js';

const PER_SHEET = 24;
const sel = { filter: 'free', kind: 'K', start: 1, top: 0, left: 0 };
let armed = null; // Code, dessen Sperre auf Bestätigung wartet

const STATUS = { free: 'frei', active: 'in Benutzung', blocked: 'gesperrt' };

function selected(all) {
  return all.filter(l => (sel.kind === 'all' || l.kind === sel.kind) && (sel.filter === 'all' ? l.status !== 'blocked' : l.status === 'free'));
}

const seg = (name, options) => `<div class="seg" role="group">${options.map(([v, label]) =>
  `<button type="button" data-act="sel" data-k="${name}" data-v="${v}" aria-pressed="${String(sel[name]) === v}">${label}</button>`).join('')}</div>`;

export const labelsView = {
  id: 'labels',
  tab: 'labels',
  async render(ctx) {
    ctx.setTitle('Etiketten', 'Reservieren und drucken');
    const all = await labels(ctx.app.household);
    const chosen = selected(all);
    const count = k => all.filter(l => l.kind === k && l.status === 'free').length;
    return `
      <section class="card stack">
        <h3>Neue Etiketten reservieren</h3>
        <p class="muted small">Jedes Etikett bekommt eine fortlaufende Nummer und einen zufälligen Code. Frei sind gerade ${count('K')} Kisten- und ${count('O')} Orts-Etiketten.</p>
        <div class="btn-row">
          <button class="btn primary" data-act="reserve" data-kind="K" data-n="24">${icon('plus')} 24 Kisten-Etiketten</button>
          <button class="btn" data-act="reserve" data-kind="O" data-n="6">${icon('plus')} 6 Orts-Etiketten</button>
        </div>
      </section>
      <section class="card stack">
        <h3>Drucken</h3>
        <div class="seg-row">${seg('kind', [['K', 'Kisten'], ['O', 'Orte'], ['all', 'Beide']])}${seg('filter', [['free', 'Nur freie'], ['all', 'Alle']])}</div>
        <p class="muted small">${chosen.length} Etiketten ausgewählt, ${Math.ceil((chosen.length + sel.start - 1) / PER_SHEET) || 0} Bogen.</p>
        <a class="btn primary" href="#/druck" ${chosen.length ? '' : 'aria-disabled="true"'}>${icon('print')} Druckansicht</a>
      </section>
      <section class="card">
        <h3 class="card-title">Alle Etiketten</h3>
        ${all.length ? `<div class="label-list">${all.map(l => `<div class="label-row">
          <a href="#/k/${l.code}" class="grow label-link"><span class="tag${l.kind === 'O' ? ' tag-o' : ''}">${humanNumber(l.kind, l.number)}</span>
            <span class="mono small muted">${l.code}</span></a>
          <span class="status s-${l.status}">${STATUS[l.status]}</span>
          ${ctx.app.isAdmin && l.status !== 'blocked'
            ? `<button class="btn small ghost${armed === l.code ? ' danger' : ''}" data-act="block" data-code="${l.code}">${armed === l.code ? 'Wirklich sperren?' : 'Sperren'}</button>` : ''}
        </div>`).join('')}</div>` : '<p class="muted">Noch keine Etiketten.</p>'}
      </section>`;
  },
  actions: {
    async reserve(el, ctx) {
      const n = Number(el.dataset.n);
      await reserveLabels(ctx.app.household, el.dataset.kind, n);
      sel.kind = el.dataset.kind;
      sel.filter = 'free';
      toast(`${n} Etiketten reserviert`);
      await ctx.rerender();
    },
    sel(el, ctx) {
      sel[el.dataset.k] = el.dataset.v;
      ctx.rerender();
    },
    async block(el, ctx) {
      if (armed !== el.dataset.code) { armed = el.dataset.code; await ctx.rerender(); return; }
      armed = null;
      await blockLabel(el.dataset.code);
      toast('Etikett gesperrt. Die Kiste bleibt erhalten.');
      await ctx.rerender();
    }
  }
};

export const printView = {
  id: 'print',
  tab: 'labels',
  async render(ctx) {
    ctx.setTitle('Druckansicht', '70 × 37 mm, 24 pro A4-Bogen', true);
    const chosen = selected(await labels(ctx.app.household));
    const cells = [...Array(sel.start - 1).fill(null), ...chosen];
    const sheets = [];
    for (let i = 0; i < cells.length; i += PER_SHEET) sheets.push(cells.slice(i, i + PER_SHEET));
    const cell = l => l ? `<div class="plabel">
        <div class="pqr">${qrSvg(labelUrl(CONFIG.APP_URL, l.code))}</div>
        <div class="ptext"><div class="pnum">${humanNumber(l.kind, l.number)}</div><div class="pcode">${l.code}</div><div class="papp">QRate</div></div>
      </div>` : '<div class="plabel empty"></div>';
    return `
      <form class="card stack no-print" data-form="printSettings">
        <div class="field-row">
          <label class="field"><span>Start bei Feld (angebrochener Bogen)</span><input class="input" id="pstart" type="number" min="1" max="24" value="${sel.start}"></label>
          <label class="field"><span>Versatz oben (mm)</span><input class="input" id="ptop" type="number" step="0.5" min="-10" max="10" value="${sel.top}"></label>
          <label class="field"><span>Versatz links (mm)</span><input class="input" id="pleft" type="number" step="0.5" min="-10" max="10" value="${sel.left}"></label>
        </div>
        <p class="muted small">Im Druckdialog „Tatsächliche Größe“ bzw. 100 % wählen, Ränder auf „Keine“. Erst einen Probedruck auf Normalpapier machen und gegen den Bogen halten.</p>
        <div class="btn-row"><button class="btn" type="submit">Übernehmen</button>
          <button class="btn primary" type="button" data-act="print" ${chosen.length ? '' : 'disabled'}>${icon('print')} Drucken</button></div>
      </form>
      ${chosen.length ? '' : '<p class="muted no-print">Keine Etiketten ausgewählt.</p>'}
      <div class="sheets" style="--ptop:${sel.top}mm; --pleft:${sel.left}mm">
        ${sheets.map(s => `<div class="sheet">${s.map(cell).join('')}</div>`).join('')}
      </div>`;
  },
  actions: {
    print() { window.print(); }
  },
  forms: {
    printSettings(f, ctx) {
      const num = (id, lo, hi, d) => Math.max(lo, Math.min(hi, Number(f.querySelector(id).value) || d));
      sel.start = Math.round(num('#pstart', 1, 24, 1));
      sel.top = num('#ptop', -10, 10, 0);
      sel.left = num('#pleft', -10, 10, 0);
      ctx.rerender();
    }
  }
};
