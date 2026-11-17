// Prüfer für Kontrast und Tippflächen (Browser). Regeln aus dem Vault (Workout Tracker 3.10.0, WCAG 2.2):
// - Kontrast: Text ≥ 4,5:1, großer Text (≥ 24 px oder ≥ 18,7 px fett) ≥ 3:1. Deaktivierte Bedienelemente zählen nicht.
// - Tippflächen: unter 24 × 24 px ist ein Fehler (WCAG 2.2 AA), unter 44 px nur ein Hinweis (Apple-Empfehlung).
//   Echter Treffertest: elementFromPoint in der Mitte und 3 px innerhalb jeder Kante muss das Element selbst treffen.
// Der Druckbogen (.sheets) ist Papier in mm und wird übersprungen, der Kamerasucher ebenso.

export async function auditContrast(p, where) {
  return p.evaluate((where) => {
    const out = [];
    const parse = (s) => {
      let m = s.match(/^rgba?\(([^)]+)\)$/);
      if (m) { const v = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return [v[0], v[1], v[2], v[3] ?? 1]; }
      m = s.match(/^color\(srgb ([^)]+)\)$/);
      if (m) { const v = m[1].split(/[\s/]+/).filter(Boolean).map(Number); return [v[0] * 255, v[1] * 255, v[2] * 255, v[3] ?? 1]; }
      return null;
    };
    const over = (top, bottom) => { const a = top[3]; return [0, 1, 2].map(i => top[i] * a + bottom[i] * (1 - a)).concat(1); };
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    // Hintergrund: Schichten von innen nach außen sammeln, bis eine deckend ist
    const background = (el) => {
      const layers = [];
      for (let e = el; e; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.backgroundImage !== 'none') return null; // Bild oder Verlauf: nicht messbar
        const c = parse(cs.backgroundColor);
        if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break; }
      }
      let base = [255, 255, 255, 1];
      for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
      return base;
    };
    const opacity = (el) => { let o = 1; for (let e = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity); return o; };
    const seen = new Set();
    const roots = [...document.querySelectorAll('#main, .top, .tabs, .toast:not([hidden])')];
    for (const root of roots) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        if (!n.textContent.trim() || seen.has(el)) continue;
        seen.add(el);
        if (el.closest('.sheets, .viewfinder, [disabled], [aria-disabled="true"], [hidden]')) continue;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (!r.width || !r.height || cs.visibility === 'hidden') continue;
        const bg = background(el);
        const fg = parse(cs.color);
        if (!bg || !fg) continue;
        const o = opacity(el);
        const shown = over([fg[0], fg[1], fg[2], fg[3] * o], bg);
        const size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700;
        const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
        const got = ratio(shown, bg);
        if (got < need - 0.005) {
          const cls = typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : '';
          out.push(`${where}: Kontrast ${got.toFixed(2)}:1 < ${need}:1 bei ${el.tagName.toLowerCase()}${cls} „${n.textContent.trim().slice(0, 24)}“ (${cs.color} auf rgb(${bg.slice(0, 3).map(Math.round).join(', ')}))`);
        }
      }
    }
    return out;
  }, where);
}

export async function auditTargets(p, where) {
  return p.evaluate((where) => {
    const errors = [], hints = [];
    const sel = 'button, a[href], input:not([type="hidden"]), select, textarea, [data-v], [role="button"], summary';
    const name = (e) => e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '') + (e.getAttribute('aria-label') ? `[${e.getAttribute('aria-label').slice(0, 24)}]` : '') + (e.textContent.trim() ? ` „${e.textContent.trim().slice(0, 20)}“` : '');
    const y0 = scrollY;
    const els = [...document.querySelectorAll(sel)].filter((e) => {
      if (e.closest('.sheets, [hidden]') || e.disabled) return false;
      if (e.parentElement?.closest(sel)) return false; // Teil eines größeren Ziels
      if (e.matches('a') && e.closest('p')) return false; // Link im Fließtext (WCAG-Ausnahme)
      // Häkchen und Auswahlknöpfe in einem Label: das Label ist die Tippfläche
      if (e.matches('input[type="checkbox"], input[type="radio"]') && e.closest('label')) return false;
      const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.pointerEvents !== 'none';
    });
    for (const e of els) {
      // Ziel = Element oder sein Label (bei Häkchen im Label)
      const fixed = e.closest('.tabs, .top, .toast');
      if (!fixed) e.scrollIntoView({ block: 'center', inline: 'nearest' });
      const r = e.getBoundingClientRect();
      const w = Math.round(r.width), h = Math.round(r.height);
      if (w < 24 || h < 24) errors.push(`${where}: Tippfläche ${w} × ${h} px (< 24) bei ${name(e)}`);
      else if (w < 44 || h < 44) hints.push(`${Math.min(w, h)} px bei ${e.tagName.toLowerCase()}${typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).join('.') : ''}`);
      // Treffertest: Mitte und 3 px innerhalb jeder Kante
      const pts = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + 3, r.top + r.height / 2], [r.right - 3, r.top + r.height / 2], [r.left + r.width / 2, r.top + 3], [r.left + r.width / 2, r.bottom - 3]];
      const centre = document.elementFromPoint(pts[0][0], pts[0][1]);
      if (!centre) continue;
      // Mitte von einer festen Leiste verdeckt (Tab-Leiste über langem Inhalt): nicht prüfbar
      if (!fixed && centre.closest('.tabs, .top, .toast')) continue;
      const miss = pts.filter(([x, y]) => { const hit = document.elementFromPoint(x, y); return !hit || !(hit === e || e.contains(hit) || hit.contains(e) && hit.matches('label')); });
      if (miss.length) errors.push(`${where}: Treffertest verfehlt ${miss.length} von 5 Punkten bei ${name(e)} (getroffen: ${(() => { const [x, y] = miss[0]; const hit = document.elementFromPoint(x, y); return hit ? name(hit) : 'nichts'; })()})`);
    }
    scrollTo(0, y0);
    return { errors, hints };
  }, where);
}
