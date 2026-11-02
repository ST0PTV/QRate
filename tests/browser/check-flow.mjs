// Browser-Check der Kernabläufe gegen die PGlite-Testumgebung (Handygröße).
// Aufruf: node tests/browser/check-flow.mjs [Ordner für Screenshots]
// Screenshots landen außerhalb des Repos (Standard: Temp-Ordner), damit nichts versehentlich eingecheckt wird.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { serve } from '../../scripts/serve.mjs';

const SHOTS = process.argv[2] || join(tmpdir(), 'qrate-shots');
mkdirSync(SHOTS, { recursive: true });
const PORT = 8800 + Math.floor(Math.random() * 100);
const server = await serve(PORT, { mock: true });
const BASE = `http://localhost:${PORT}/`;

const browser = await chromium.launch();
const failures = [];
let step = 0;

function check(cond, msg) {
  if (!cond) { failures.push(msg); console.log('  FEHLER: ' + msg); }
}

// Ein Browser-Kontext für alles: die Test-Datenbank liegt in IndexedDB und bleibt beim Nutzerwechsel erhalten.
// Der erste Aufruf legt sie mit ?reset neu an.
let shared = null;
let who = '';
async function newPage(as, query = '') {
  if (!shared) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark' });
    shared = await ctx.newPage();
    shared.on('console', m => { if (m.type() === 'error') failures.push(`Konsole (${who}): ${m.text()}`); });
    shared.on('pageerror', e => failures.push(`Seitenfehler (${who}): ${e.message}`));
    query += '&reset=1';
  }
  who = as;
  const page = shared;
  await page.goto(`${BASE}?as=${as}${query}`);
  await page.waitForFunction(() => window.__mockReady === true, null, { timeout: 30000 });
  await page.waitForSelector('#main :not(.loading)');
  return page;
}

async function settle(page) {
  await page.waitForTimeout(150);
  await page.waitForFunction(() => !document.querySelector('#main .loading'));
}

async function shot(page, name) {
  await settle(page);
  const text = await page.locator('#main').innerText();
  check(!/\b(null|undefined|NaN)\b|\[object Object\]/.test(text), `${name}: verdächtiger Text im Inhalt`);
  const file = join(SHOTS, `${String(++step).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`  ${name}`);
}

const codes = async page => page.evaluate(() => window.__mockCodes);

// Wartet bis zu 5 s, bis fn() wahr liefert (Seite zeichnet nach einer Aktion neu)
async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if (await fn()) return true; } catch { /* Element noch nicht da */ }
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
}

try {
  // ---------- Alex: Übersicht, Kiste, Inhalt, Verschieben ----------
  console.log('Alex');
  let page = await newPage('alex');
  await shot(page, 'uebersicht');
  check(await page.locator('.row-title', { hasText: 'Weihnachtsdeko' }).isVisible(), 'Übersicht zeigt Kiste Weihnachtsdeko');

  await page.locator('.row-title', { hasText: 'Kabel & Adapter' }).click();
  await shot(page, 'kiste');
  check(await page.locator('.item-name', { hasText: 'HDMI-Adapter USB-C' }).isVisible(), 'Kiste zeigt ihre Gegenstände');

  await page.getByRole('button', { name: 'Hinzufügen' }).click();
  await page.fill('#quick', '2x Klinkenkabel, Kabelbinder x50');
  check((await page.locator('#quickPreview').innerText()).includes('50× Kabelbinder'), 'Vorschau der Schnelleingabe');
  await page.getByRole('button', { name: 'Hinzufügen', exact: true }).last().click();
  await page.locator('.item-name', { hasText: 'Kabelbinder' }).waitFor();
  await shot(page, 'kiste-hinzugefuegt');

  await page.locator('[data-act="take"][data-name="Klinkenkabel"]').click();
  await page.locator('#toast', { hasText: 'Klinkenkabel“ entnommen' }).waitFor();
  check(await until(() => page.locator('.items .item:not(.removed) .item-name', { hasText: 'Klinkenkabel' }).count().then(n => n === 0)), 'Entnommenes verschwindet aus der Liste');
  await page.getByText('Entnommene anzeigen').click();
  await page.locator('.item.removed', { hasText: 'Klinkenkabel' }).waitFor();

  await page.getByRole('button', { name: 'Verschieben' }).click();
  await shot(page, 'verschieben');
  await page.locator('.choice', { hasText: 'Dachboden' }).click();
  await page.locator('#toast', { hasText: 'Verschoben' }).waitFor();
  check(await until(() => page.locator('.box-head', { hasText: 'Dachboden' }).isVisible()), 'Kiste steht nach dem Verschieben im Dachboden');
  await page.locator('#events li').first().waitFor();
  check(await until(async () => (await page.locator('#events').innerText()).includes('nach Dachboden verschoben')), 'Verlauf zeigt das Verschieben');

  // Bearbeiten
  await page.locator('.item', { hasText: 'Kabelbinder' }).locator('[data-act="panel"]').click();
  await page.fill('#eqty', '40');
  await page.fill('#enote', 'schwarz, 200 mm');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await page.locator('.item-note', { hasText: 'schwarz, 200 mm' }).waitFor();
  check(await page.locator('.item', { hasText: 'Kabelbinder' }).locator('.qty', { hasText: '40×' }).isVisible(), 'Menge geändert');

  // Suche
  await page.locator('.tabs [data-tab="search"]').click();
  await page.fill('#q', 'stirnlampe');
  await page.locator('#results .row-link').first().waitFor();
  await shot(page, 'suche');
  check((await page.locator('#results').innerText()).includes('3× Stirnlampen'), 'Suche findet Stirnlampen');

  // Scan per Nummer: freies Etikett anlegen
  await page.locator('.tabs [data-tab="scan"]').click();
  await shot(page, 'scannen');
  await page.fill('#manual', 'k-5');
  await page.getByRole('button', { name: 'Öffnen' }).click();
  await page.getByText('Neue Kiste anlegen?').waitFor();
  await shot(page, 'freies-etikett');
  await page.fill('#claimName', 'Fotoalben');
  await page.selectOption('#claimLoc', { label: 'Keller › Regal 1' });
  await page.getByRole('button', { name: 'Ja, anlegen' }).click();
  await page.locator('#quick').waitFor();
  check(await page.locator('.box-head', { hasText: 'Fotoalben' }).isVisible(), 'Neue Kiste ist angelegt');
  await page.fill('#quick', 'Hochzeitsalbum, 3 Urlaubsalben');
  await page.getByRole('button', { name: 'Hinzufügen', exact: true }).last().click();
  await page.locator('.item-name', { hasText: 'Urlaubsalben' }).waitFor();
  await shot(page, 'neue-kiste');

  // Verschieben per Orts-Etikett: ein freies O-Etikett wird dabei zum neuen Ort
  const c = await codes(page);
  await page.getByRole('button', { name: 'Verschieben' }).click();
  await page.getByRole('button', { name: 'Orts-Etikett scannen' }).click();
  await page.locator('.banner').waitFor();
  await shot(page, 'scannen-verschieben');
  await page.fill('#manual', c.o[2]);
  await page.getByRole('button', { name: 'Öffnen' }).click();
  await page.getByText('Neuen Ort anlegen?').waitFor();
  check(await page.getByText('Danach kommt K-0005').isVisible(), 'Hinweis auf wartendes Verschieben');
  await page.fill('#claimName', 'Flur › Einbauschrank');
  await page.getByRole('button', { name: 'Ja, anlegen' }).click();
  await page.locator('.box-head', { hasText: 'Flur › Einbauschrank' }).waitFor();

  // QR-Adresse direkt öffnen (wie die Handykamera)
  await page.goto(`${BASE}?k=${c.o[0]}`);
  await page.waitForFunction(() => window.__mockReady === true);
  await page.getByText('Ort', { exact: true }).waitFor();
  await shot(page, 'ort');
  check(await page.locator('.row-title', { hasText: 'Werkzeug' }).isVisible(), 'Ort listet seine Kisten');

  // Etiketten
  await page.locator('.tabs [data-tab="labels"]').click();
  await page.getByRole('button', { name: '24 Kisten-Etiketten' }).click();
  await page.locator('#toast', { hasText: '24 Etiketten reserviert' }).waitFor();
  await shot(page, 'etiketten');
  check(await page.getByText('K-0036').isVisible(), 'Neue Etiketten setzen die Nummer fort');
  await page.getByRole('link', { name: 'Druckansicht' }).click();
  await page.locator('.sheet').first().waitFor();
  await shot(page, 'druckansicht');
  const sheetCount = await page.locator('.sheet').count();
  check(sheetCount === 2, `Druckansicht: 31 freie Kisten-Etiketten ergeben 2 Bogen (gefunden ${sheetCount})`);
  const qrOk = await page.locator('.plabel .pqr svg').count();
  check(qrOk === 31, `Jedes Etikett hat einen QR-Code (${qrOk})`);

  // Haushalt: Einladung
  await page.locator('.tabs [data-tab="house"]').click();
  await page.getByRole('button', { name: 'Einladung erzeugen' }).click();
  await page.locator('.invite-qr svg').waitFor();
  await shot(page, 'haushalt');
  const token = (await page.locator('.invite .mono').innerText()).trim();
  check(/^[0-9A-HJKMNP-TV-Z]{16}$/.test(token), 'Einladungscode hat 16 Zeichen');

  // ---------- Neu: Einladung annehmen, wartet, Alex bestätigt ----------
  console.log('Neu');
  page = await newPage('neu', `&invite=${token}`);
  await page.getByText('Einladung annehmen').waitFor();
  await page.fill('#displayName', 'Sam');
  await page.getByRole('button', { name: 'Beitreten' }).click();
  await page.getByText('Fast geschafft').waitFor();
  await shot(page, 'wartet');

  // ---------- Fremd: fremdes Etikett ----------
  console.log('Fremd');
  page = await newPage('fremd', `&k=${c.k[0]}`);
  await page.getByRole('heading', { name: 'Haushalt gründen' }).waitFor();
  await page.fill('#hhName', 'Andere Wohnung');
  await page.fill('#displayName', 'Fremd');
  await page.getByRole('button', { name: 'Haushalt gründen' }).click();
  // Nach dem Gründen öffnet die App das vorher gescannte Etikett – es gehört Alex, also kein Zugriff
  await page.getByRole('heading', { name: 'Kein Zugriff' }).waitFor();
  await shot(page, 'kein-zugriff');
  check(!(await page.getByText('Weihnachtsdeko').count()), 'Fremder sieht keinen Kistennamen');

  // ---------- Nicht angemeldet ----------
  console.log('Abgemeldet');
  page = await newPage('none', `&k=${c.k[0]}`);
  await page.getByText('Privates Etikett').waitFor();
  await shot(page, 'login');
  check(!(await page.getByText('Weihnachtsdeko').count()), 'Ohne Login kein Inhalt');
  await page.fill('#email', 'robin@example.org');
  await page.getByRole('button', { name: 'Code schicken' }).click();
  await page.fill('#otp', '123456');
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await page.locator('.box-head', { hasText: 'Weihnachtsdeko' }).waitFor();
  await shot(page, 'nach-login-kiste');

  // ---------- Hell ----------
  await page.emulateMedia({ colorScheme: 'light' });

  await page.goto(`${BASE}?as=alex`);
  await page.waitForFunction(() => window.__mockReady === true);
  await page.waitForSelector('.stats');
  await shot(page, 'uebersicht-hell');

} catch (e) {
  failures.push('Abbruch: ' + e.message.split('\n')[0]);
  console.log(e);
} finally {
  await browser.close();
  server.close();
}

console.log(`\nScreenshots: ${SHOTS}`);
if (failures.length) {
  console.log(`\n${failures.length} Fehler:\n- ` + failures.join('\n- '));
  process.exit(1);
}
console.log('OK: alle Browser-Checks bestanden');
