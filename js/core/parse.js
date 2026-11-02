// Schnelleingabe: "3x Kugeln, Lichterkette, Kabelbinder x20" -> [{ name, qty }]
// Komma, Semikolon, Zeilenumbruch und " und " trennen. Menge vorn ("3x", "3 ×", "3 ") oder hinten ("x20", "20x").
// Eine Zahl am Ende ohne x (z. B. "Wasserwaage 60") bleibt Teil des Namens.

const MAX_QTY = 99999;
const MAX_NAME = 120;

export function parseQuick(text) {
  return String(text ?? '')
    .split(/[,;\n]+|\s+und\s+/i)
    .map(s => s.trim())
    .filter(Boolean)
    .map(parseOne)
    .filter(x => x.name && x.qty >= 1);
}

function parseOne(s) {
  let m = s.match(/^(\d{1,5})\s*[x×]\s*(.+)$/i) || s.match(/^(\d{1,5})\s+(.+)$/);
  if (m) return item(m[2], m[1]);
  m = s.match(/^(.+?)\s*(?:[x×]\s*(\d{1,5})|(\d{1,5})\s*[x×])$/i);
  if (m && /\s/.test(s.slice(m[1].length, m[1].length + 1) || ' ')) return item(m[1], m[2] ?? m[3]);
  return item(s, 1);
}

function item(name, qty) {
  return { name: name.trim().slice(0, MAX_NAME), qty: Math.min(MAX_QTY, Number(qty)) };
}
