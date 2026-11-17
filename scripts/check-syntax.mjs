// Prüft die Syntax aller JS-Dateien und ob sw.js jede ausgelieferte Datei im PRECACHE führt.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const walk = dir => readdirSync(dir).flatMap(f => {
  const p = join(dir, f).replaceAll('\\', '/');
  return statSync(p).isDirectory() ? walk(p) : [p];
});

let failed = false;
const js = [...walk('js'), 'sw.js', ...walk('scripts').filter(f => f.endsWith('.mjs'))];
for (const f of js) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { failed = true; console.error(`Syntaxfehler in ${f}:\n${e.stderr}`); }
}

const sw = readFileSync('sw.js', 'utf8');
const listed = new Set([...sw.matchAll(/'([^']+)'/g)].map(m => m[1]));
const shipped = [...walk('js'), ...walk('css'), ...walk('vendor').filter(f => f.endsWith('.js')), ...walk('icons'), 'index.html', 'manifest.webmanifest'];
for (const f of shipped) {
  if (!listed.has(f)) { failed = true; console.error(`Fehlt in PRECACHE von sw.js: ${f}`); }
}
for (const f of listed) {
  if (f.includes('/') && !f.startsWith('qr-') && f !== './' && !shipped.includes(f)) { failed = true; console.error(`In PRECACHE, aber nicht vorhanden: ${f}`); }
}

// Sicherheitskopf: vorhanden, Skripte nur aus dem eigenen Ordner, Supabase-Adresse wie in config.js
const html = readFileSync('index.html', 'utf8');
const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
const supa = readFileSync('js/core/config.js', 'utf8').match(/SUPABASE_URL:\s*'([^']*)'/)?.[1];
if (!csp) { failed = true; console.error('index.html: Sicherheitskopf (Content-Security-Policy) fehlt'); }
else {
  const dir = name => csp.split(';').map(s => s.trim()).find(s => s.startsWith(name + ' ')) ?? '';
  if (dir('script-src') !== "script-src 'self'") { failed = true; console.error(`Sicherheitskopf: script-src soll nur 'self' erlauben, ist: ${dir('script-src')}`); }
  if (!dir('object-src').includes("'none'")) { failed = true; console.error("Sicherheitskopf: object-src 'none' fehlt"); }
  if (supa) {
    const origin = new URL(supa).origin;
    for (const d of ['connect-src', 'img-src']) {
      if (!dir(d).split(' ').includes(origin)) { failed = true; console.error(`Sicherheitskopf: ${d} erlaubt ${origin} nicht (Adresse aus config.js)`); }
    }
  }
}

if (failed) process.exit(1);
console.log(`OK: ${js.length} Skripte, ${shipped.length} Dateien im Offline-Cache`);
