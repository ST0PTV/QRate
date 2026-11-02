# Hinweise für Claude

- Öffentliches Repo: niemals persönliche Daten, echte Namen, Orte, E-Mail-Adressen oder Schlüssel einchecken. Vor jedem Push `npm run privacy`.
- Sprache: Oberfläche und Kommentare auf Deutsch, kurze Sätze.
- Kein Build-Schritt, keine Abhängigkeiten zur Laufzeit außer `vendor/`. ES-Module, ein Modul pro Zuständigkeit.
- Supabase nur über `js/core/api.js`, localStorage nur über `js/core/store.js` (Präfix `kw_`).
- Rechte prüft die Datenbank (Row-Level-Security, Funktionen in `supabase/migrations/`). Neue Tabellen oder Funktionen: Policy plus Test in `tests/db.test.js`, auch für den Fremden-Fall.
- Schemaänderung = neue Migrationsdatei, nie eine alte ändern, die schon in Supabase läuft. Danach `MIGRATIONS` in `tests/helpers/auth-stub.js` ergänzen.
- Neue Datei in `js/`, `css/`, `vendor/` oder `icons/` → in `PRECACHE` von `sw.js` eintragen und `CACHE_VERSION` erhöhen (`npm run check` prüft das).
- Neue Abfrage in `api.js` → dieselbe Funktion in `tests/browser/mock-api.js` nachbauen.
- Farben nur über Tokens in `css/app.css`. Eigene Strich-Icons in `js/core/ui.js`, keine Emoji.
- Vor dem Commit: `npm test && npm run check`. Vor Release zusätzlich `npm run test:browser` und die Screenshots ansehen.
