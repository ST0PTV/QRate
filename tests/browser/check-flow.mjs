// Browser-Check der Kernabläufe gegen die PGlite-Testumgebung (Handygröße).
// Aufruf: node tests/browser/check-flow.mjs [Ordner für Screenshots]
// Screenshots landen außerhalb des Repos (Standard: Temp-Ordner), damit nichts versehentlich eingecheckt wird.
import { chromium } from 'playwright';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { serve } from '../../scripts/serve.mjs';
import { auditSpacing, auditFields, auditWords } from './spacing.mjs';
import { auditContrast, auditTargets } from './a11y.mjs';

const SHOTS = process.argv[2] || join(tmpdir(), 'qrate-shots');
mkdirSync(SHOTS, { recursive: true });
// alte Screenshots weg, damit keine Bilder eines früheren Laufs übrig bleiben
for (const f of readdirSync(SHOTS)) if (f.endsWith('.png')) rmSync(join(SHOTS, f));
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
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
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
  // Abstände und Felder nach den Regeln aus The Tracker
  for (const x of [...await auditSpacing(page, name), ...await auditFields(page, name), ...await auditWords(page, name)]) check(false, x);
  await auditA11y(page, name);
}

// Kontrast und Tippflächen; Hinweise (< 44 px) nach Elementart zählen und am Ende einmal ausgeben
const hints = new Map();
async function auditA11y(page, name) {
  for (const x of await auditContrast(page, name)) check(false, x);
  const t = await auditTargets(page, name);
  for (const x of t.errors) check(false, x);
  for (const x of new Set(t.hints)) {
    const h = hints.get(x) ?? { n: 0, first: name };
    h.n++;
    hints.set(x, h);
  }
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

  await page.getByRole('button', { name: 'Hinzufügen', exact: true }).first().click();
  await page.fill('#quick', '2x Klinkenkabel, Kabelbinder x50');
  check((await page.locator('#quickPreview').innerText()).includes('50× Kabelbinder'), 'Vorschau der Schnelleingabe');
  await page.getByRole('button', { name: 'Hinzufügen', exact: true }).last().click();
  await page.locator('.item-name', { hasText: 'Kabelbinder' }).waitFor();
  await shot(page, 'kiste-hinzugefuegt');

  // Gegenstand bearbeiten und Kiste umbenennen: nur Ansicht für die Feld-Prüfung, dann abbrechen
  // Kein Stift-Knopf mehr: Tipp auf den Namen öffnet Bearbeiten
  check(await page.locator('.item .icon-btn:not(.take)').count() === 0, 'Gegenstandszeile hat keinen eigenen Stift-Knopf');
  await page.locator('.item .item-name').first().click();
  await page.locator('#ename').waitFor();
  await shot(page, 'gegenstand-bearbeiten');
  await page.getByRole('button', { name: 'Umbenennen' }).click();
  await page.locator('#boxName').waitFor();
  await shot(page, 'kiste-umbenennen');
  await page.getByRole('button', { name: 'Abbrechen' }).click();

  await page.locator('[data-act="take"][data-name="Klinkenkabel"]').click();
  await page.locator('#toast', { hasText: 'Klinkenkabel“ entnommen' }).waitFor();
  check(await until(() => page.locator('.items .item:not(.removed) .item-name', { hasText: 'Klinkenkabel' }).count().then(n => n === 0)), 'Entnommenes verschwindet aus der Liste');
  await page.getByText('Entnommene anzeigen').click();
  await page.locator('.item.removed', { hasText: 'Klinkenkabel' }).waitFor();

  // Fotos: zwei hochladen (das App-Icon als Testbild), eins löschen
  await page.locator('#photoInput').setInputFiles(['icons/icon-512.png', 'icons/icon-192.png']);
  await page.locator('#toast', { hasText: 'Fotos gespeichert' }).waitFor();
  check(await page.locator('.photo-main img').isVisible(), 'Foto wird groß angezeigt');
  check(await page.locator('.photo-thumb img').count() === 2, 'Zwei Vorschaubilder nach dem Hochladen');
  await shot(page, 'kiste-fotos');
  await page.locator('[data-act="photoDelete"]').click();
  await page.getByRole('button', { name: 'Wirklich löschen?' }).click();
  await page.locator('#toast', { hasText: 'Foto gelöscht' }).waitFor();
  check(await until(() => page.locator('.photo-thumb img').count().then(n => n === 1)), 'Nach dem Löschen bleibt ein Foto');

  // Foto pro Gegenstand: aufnehmen, freigestelltes Bild aus der Zwischenablage übernehmen, groß ansehen, entfernen
  await page.locator('[aria-label="Foto für HDMI-Adapter USB-C hinzufügen"]').click();
  await page.locator('#itemPic').waitFor();
  await shot(page, 'gegenstand-foto-start');
  await page.locator('#itemShot').setInputFiles('icons/icon-512.png');
  await page.locator('.pic-shot').waitFor();
  await shot(page, 'gegenstand-foto-aufgenommen');
  // Ersatz für „Auswahl kopieren“: ein PNG mit durchsichtigem Rand in die Zwischenablage legen
  await page.evaluate(async () => {
    const c = Object.assign(document.createElement('canvas'), { width: 200, height: 200 });
    const g = c.getContext('2d');
    g.fillStyle = '#9A6A3D';
    g.fillRect(50, 60, 100, 90);
    const blob = await new Promise(ok => c.toBlob(ok, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  });
  await page.getByRole('button', { name: 'Freigestellt übernehmen' }).first().click();
  await page.locator('#toast', { hasText: 'Freigestelltes Foto gespeichert' }).waitFor();
  check(await until(() => page.locator('.item-pic img').count().then(n => n === 1)), 'Gegenstand zeigt sein Vorschaubild');
  await page.locator('[aria-label="Foto von HDMI-Adapter USB-C ansehen"]').click();
  await page.locator('.pic-view img').waitFor();
  await shot(page, 'gegenstand-foto-gross');
  await page.locator('[data-act="picDelete"]').click();
  await page.getByRole('button', { name: 'Wirklich entfernen?' }).click();
  await page.locator('#toast', { hasText: 'Foto entfernt' }).waitFor();
  check(await until(() => page.locator('.item-pic img').count().then(n => n === 0)), 'Nach dem Entfernen kein Vorschaubild mehr');

  // Ohne Freistellen: normales Foto als JPEG
  await page.locator('[aria-label="Foto für HDMI-Adapter USB-C hinzufügen"]').click();
  await page.locator('#itemShot').setInputFiles('icons/icon-192.png');
  await page.getByRole('button', { name: 'Ohne Freistellen' }).click();
  await page.locator('#toast', { hasText: /^Foto gespeichert/ }).waitFor();
  check(await until(() => page.locator('.item-pic img').count().then(n => n === 1)), 'Foto ohne Freistellen wird gespeichert');

  await page.getByRole('button', { name: 'Verschieben' }).click();
  await shot(page, 'verschieben');
  await page.locator('.choice', { has: page.locator('.choice-name', { hasText: /^Dachboden$/ }) }).click();
  await page.locator('#toast', { hasText: 'Verschoben' }).waitFor();
  check(await until(() => page.locator('.box-head .crumb', { hasText: 'Dachboden' }).isVisible()), 'Kiste steht nach dem Verschieben im Dachboden');
  await page.locator('#events li').first().waitFor();
  check(await until(async () => (await page.locator('#events').innerText()).includes('nach Dachboden gestellt')), 'Verlauf zeigt das Verschieben');

  // Bearbeiten
  await page.locator('.item', { hasText: 'Kabelbinder' }).locator('[data-v^="edit:"]').click();
  await page.fill('#eqty', '40');
  await page.fill('#enote', 'schwarz, 200 mm');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await page.locator('.item-note', { hasText: 'schwarz, 200 mm' }).waitFor();
  check(await page.locator('.item', { hasText: 'Kabelbinder' }).locator('.qty', { hasText: '40×' }).isVisible(), 'Menge geändert');

  // Suche zeigt den Pfad
  await page.locator('.tabs [data-tab="search"]').click();
  await page.fill('#q', 'stirnlampe');
  await page.locator('#results .row-link').first().waitFor();
  await shot(page, 'suche');
  check((await page.locator('#results').innerText()).includes('3× Stirnlampen'), 'Suche findet Stirnlampen');
  await page.fill('#q', 'akkuschrauber');
  check(await until(async () => (await page.locator('#results').innerText()).includes('Keller › Regal 1')), 'Suche zeigt den Pfad');

  // Altes K-Etikett: Typ Kiste ist vorgewählt, Inhalt gleich mit erfassen
  await page.locator('.tabs [data-tab="scan"]').click();
  await shot(page, 'scannen');
  await page.fill('#manual', 'k-5');
  await page.getByRole('button', { name: 'Öffnen' }).click();
  await page.getByText('Kiste anlegen').waitFor();
  await shot(page, 'freies-etikett');
  await page.fill('#claimName', 'Fotoalben');
  await page.selectOption('#claimLoc', { label: 'Keller › Regal 1' });
  await page.fill('#claimItems', 'Hochzeitsalbum, 3 Urlaubsalben');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await page.locator('.item-name', { hasText: 'Urlaubsalben' }).waitFor();
  check(await page.locator('.box-head', { hasText: 'Fotoalben' }).isVisible(), 'Neue Kiste ist angelegt');
  check(await page.locator('.box-head .crumb', { hasText: 'Regal 1' }).isVisible(), 'Neue Kiste steht im Regal');
  await shot(page, 'neue-kiste');

  // Neutrales Etikett beim Verschieben: erst Typ wählen, dann landet die Kiste darin
  const c = await codes(page);
  await page.getByRole('button', { name: 'Verschieben' }).click();
  await page.getByRole('button', { name: 'Ziel-Etikett scannen' }).click();
  await page.locator('.banner').waitFor();
  await shot(page, 'scannen-verschieben');
  await page.fill('#manual', '#4');
  await page.getByRole('button', { name: 'Öffnen' }).click();
  await page.getByText('Was ist das?').waitFor();
  await shot(page, 'typ-waehlen');
  await page.getByRole('button', { name: 'Schrank', exact: true }).click();
  await page.getByText('Danach kommt „Fotoalben“ hierhin.').waitFor();
  await page.fill('#claimName', 'Einbauschrank');
  await page.selectOption('#claimLoc', { label: 'Dachboden' });
  await shot(page, 'neues-ding');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await page.locator('.box-head .crumb', { hasText: 'Dachboden › Einbauschrank' }).waitFor();

  // Typ ändern
  await page.getByRole('button', { name: 'Typ', exact: true }).click();
  await shot(page, 'typ-aendern');
  await page.getByRole('button', { name: 'Ordner / Mappe' }).click();
  await page.locator('#toast', { hasText: 'Jetzt: Ordner / Mappe' }).waitFor();
  check(await until(async () => (await page.locator('#events').innerText()).includes('Typ zu „Ordner / Mappe“')), 'Verlauf zeigt den Typwechsel');

  // Verleihen mit Erinnerung heute: steht auf der Übersicht als fällig
  await page.getByRole('button', { name: 'Verleihen' }).click();
  await page.locator('#lendName').waitFor();
  await page.fill('#lendName', 'Jonas');
  await page.fill('#lendPhone', 'Test-Nummer');
  await page.getByRole('button', { name: '2 Wochen' }).click();
  check((await page.inputValue('#lendDate')).length === 10, 'Schnellwahl setzt das Erinnerungsdatum');
  await page.fill('#lendDate', await page.evaluate(() => new Date().toLocaleDateString('sv-SE')));
  await page.uncheck('#lendCal');
  await shot(page, 'verleihen');
  await page.locator('form[data-form="lendForm"] button[type="submit"]').click();
  await page.locator('.lent-bar', { hasText: 'An Jonas' }).waitFor();
  await shot(page, 'verliehen');
  check(await page.locator('a[href^="sms:"]').count() === 1, 'Nachricht-Knopf bei Telefonnummer');
  await page.locator('.tabs [data-tab="home"]').click();
  await page.locator('.lent .lend-row.due', { hasText: 'Fotoalben' }).waitFor();
  await shot(page, 'uebersicht-verliehen');
  await page.locator('.lent [data-act="returned"]').click();
  await page.locator('#toast', { hasText: 'Zurück erhalten' }).waitFor();
  check(await until(() => page.locator('.lent').count().then(n => n === 0)), 'Nach dem Zurückgeben ist nichts mehr verliehen');

  // QR-Adresse direkt öffnen (wie die Handykamera): das Regal zeigt, was darin steht
  await page.goto(`${BASE}?k=${c.q[1]}`);
  await page.waitForFunction(() => window.__mockReady === true);
  await page.locator('.box-head', { hasText: 'Regal 1' }).waitFor();
  await shot(page, 'ort');
  check(await page.locator('.row-title', { hasText: 'Werkzeug' }).isVisible(), 'Regal listet seine Kisten');

  // Einräumen: Ziel öffnen, dann ein freies Etikett anlegen und eine bestehende Kiste scannen
  await page.getByRole('button', { name: 'Einräumen' }).click();
  await page.locator('.banner', { hasText: 'Einräumen in „Regal 1“' }).waitFor();
  await page.fill('#manual', '#5');
  await page.getByRole('button', { name: 'Öffnen' }).click();
  await page.getByText('Was ist das?').waitFor();
  await page.getByRole('button', { name: 'Kiste', exact: true }).click();
  await page.getByText('Vorgeschlagen: Ziel beim Einräumen.').waitFor();
  await page.fill('#claimName', 'Winterjacken');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await page.locator('.stow-row', { hasText: 'Winterjacken' }).waitFor();
  await page.fill('#manual', 'k-1');
  await page.getByRole('button', { name: 'Öffnen' }).click();
  await page.locator('.stow-row', { hasText: 'vorher: Dachboden' }).waitFor();
  await shot(page, 'einraeumen');
  await page.getByRole('button', { name: 'Fertig' }).click();
  await page.locator('.box-head', { hasText: 'Regal 1' }).waitFor();
  check(await page.locator('.row-title', { hasText: 'Weihnachtsdeko' }).isVisible(), 'Eingeräumte Kiste steht im Regal');
  check(await page.locator('.row-title', { hasText: 'Winterjacken' }).isVisible(), 'Neu angelegte Kiste steht im Regal');

  // Etiketten: neutrale Etiketten reservieren und drucken
  await page.locator('.tabs [data-tab="labels"]').click();
  await page.getByRole('button', { name: '24 Etiketten (1 Bogen)' }).click();
  await page.locator('#toast', { hasText: '24 Etiketten reserviert' }).waitFor();
  await shot(page, 'etiketten');
  check(await page.getByText('#0032').isVisible(), 'Neue Etiketten setzen die Nummer fort');
  await page.getByRole('link', { name: 'Druckansicht' }).click();
  await page.locator('.sheet').first().waitFor();
  await shot(page, 'druckansicht');
  const sheetCount = await page.locator('.sheet').count();
  check(sheetCount === 2, `Druckansicht: 27 freie neutrale Etiketten ergeben 2 Bogen (gefunden ${sheetCount})`);
  const qrOk = await page.locator('.plabel .pqr svg').count();
  check(qrOk === 27, `Jedes Etikett hat einen QR-Code (${qrOk})`);

  // Haushalt: Einladung
  await page.locator('.tabs [data-tab="house"]').click();
  await page.getByRole('button', { name: 'Einladung erzeugen' }).click();
  await page.locator('.invite-qr svg').waitFor();
  await shot(page, 'haushalt');
  const token = (await page.locator('.invite .mono').innerText()).trim();
  check(/^[0-9A-HJKMNP-TV-Z]{16}$/.test(token), 'Einladungscode hat 16 Zeichen');
  // Darstellung: Hell setzt html[data-theme], System nimmt es wieder weg
  await page.getByRole('button', { name: 'Hell', exact: true }).click();
  check(await until(() => page.evaluate(() => document.documentElement.dataset.theme === 'light')), 'Darstellung Hell wird angewendet');
  await page.getByRole('button', { name: 'System', exact: true }).click();
  check(await until(() => page.evaluate(() => !document.documentElement.dataset.theme)), 'Darstellung System folgt wieder dem Gerät');

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
  await shot(page, 'haushalt-gruenden');
  await page.fill('#hhName', 'Andere Wohnung');
  await page.fill('#displayName', 'Fremd');
  await page.getByRole('button', { name: 'Haushalt gründen' }).click();
  // Nach dem Gründen öffnet die App das vorher gescannte Etikett – es gehört Alex, also kein Zugriff
  await page.locator('#main').getByRole('heading', { name: 'Kein Zugriff' }).waitFor();
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
  check(await page.locator('.taken .row-title', { hasText: 'Klinkenkabel' }).isVisible(), 'Übersicht zeigt gerade entnommene Gegenstände');
  check(await page.locator('.tree .row-title', { hasText: 'Einbauschrank' }).isVisible(), 'Übersicht zeigt den Baum');
  await shot(page, 'uebersicht-hell');

  // ---------- Schmal: 320 px (iPhone SE 1. Generation), hell und dunkel, mit langem Namen tief im Baum ----------
  console.log('Schmal');
  await page.setViewportSize({ width: 320, height: 640 });
  // alles aufklappen, dann das am tiefsten verschachtelte Ding nehmen
  for (let i = 0; i < 10; i++) {
    const closed = page.locator('.tree-toggle[aria-expanded="false"]');
    if (!(await closed.count())) break;
    await closed.first().click();
    await settle(page);
  }
  const deep = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.tree-row')].map(r => ({ depth: Number(r.style.getPropertyValue('--depth')), href: r.querySelector('a.row-link').getAttribute('href') }));
    rows.sort((a, b) => b.depth - a.depth);
    return rows[0];
  });
  check(deep && deep.depth >= 2, `Baum hat mindestens drei Ebenen (tiefste: ${deep?.depth})`);
  const deepId = deep.href.replace('#/box/', '');
  const longName = 'Werkzeugkiste mit Ersatzteilen für Fahrrad und Anhänger';
  await page.evaluate(async ([id, name]) => { const api = await import('/js/core/api.js'); await api.renameBox(id, name); }, [deepId, longName]);
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    const tag = scheme === 'light' ? 'hell' : 'dunkel';
    for (const [route, name] of [['', 'uebersicht'], [`box/${deepId}`, 'tief'], ['suche', 'suche'], ['etiketten', 'etiketten'], ['haushalt', 'haushalt']]) {
      await page.evaluate(r => { location.hash = '#/' + r; }, route);
      await page.waitForFunction(r => location.hash === '#/' + r, route);
      if (route === 'suche') {
        await page.locator('#main input').first().fill('Fahrrad');
        await page.locator('.row-title', { hasText: 'Werkzeugkiste' }).first().waitFor();
      }
      if (route.startsWith('box/')) await page.locator('.box-head', { hasText: 'Werkzeugkiste' }).waitFor();
      await shot(page, `schmal-${tag}-${name}`);
      // nichts darf breiter als der Bildschirm werden
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      check(wide <= 0, `schmal-${tag}-${name}: Seite ist ${wide} px breiter als 320 px`);
    }
  }

} catch (e) {
  failures.push('Abbruch: ' + e.message.split('\n')[0]);
  console.log(e);
  // Zustand beim Abbruch festhalten: Bild und sichtbare Meldung
  try {
    await shared?.screenshot({ path: join(SHOTS, 'abbruch.png'), fullPage: true });
    const t = await shared?.locator('#toast:not([hidden])').innerText({ timeout: 500 }).catch(() => '');
    if (t) console.log('Meldung beim Abbruch: ' + t);
  } catch { /* Seite schon zu */ }
} finally {
  await browser.close();
  server.close();
}

if (hints.size) console.log(`\nHinweise (unter 44 px, kein Fehler):\n- ` + [...hints].map(([h, v]) => `${h} – auf ${v.n} Seiten, zuerst: ${v.first}`).join('\n- '));
console.log(`\nScreenshots: ${SHOTS}`);
if (failures.length) {
  console.log(`\n${failures.length} Fehler:\n- ` + failures.join('\n- '));
  process.exit(1);
}
console.log('OK: alle Browser-Checks bestanden');
