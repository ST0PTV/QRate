# Kistenwerk

QR-Etiketten für Kisten im Haushalt. Etikett scannen, Inhalt sehen. Mehrere Mitglieder pro Haushalt, jeder Eintrag zeigt, wer ihn angelegt hat.

- **Etiketten:** fortlaufende Nummer (K-0042 für Kisten, O-007 für Orte) plus zufälliger 8-stelliger Code im QR. Druckbogen 70 × 37 mm, 24 pro A4.
- **Erster Scan eines freien Etiketts:** „Neue Kiste anlegen?“, danach Inhalt per Schnelleingabe („3x Kugeln, Lichterkette“).
- **Orte:** Orts-Etikett ans Regal, Kiste verschieben per Scan.
- **Suche:** tippfehlertolerant über Gegenstände und Kistennamen.
- **Sicherheit:** Der QR-Code enthält nur den Zufallscode. Inhalte gibt die Datenbank nur angemeldeten, bestätigten Mitgliedern des Haushalts heraus (Row-Level-Security). Unbekannte und fremde Codes sehen gleich aus.

## Technik

Statische PWA ohne Build-Schritt (HTML, CSS, ES-Module), Daten und Login über [Supabase](https://supabase.com) (Postgres, E-Mail-Code). Hosting auf GitHub Pages.

| Ordner | Inhalt |
| --- | --- |
| `js/core/` | Supabase-Zugriff, Speicher, Codes, Schnelleingabe, Scanner, UI-Helfer |
| `js/features/` | Seiten: Anmeldung, Übersicht, Kiste/Ort, Scannen, Suche, Etiketten, Haushalt |
| `supabase/migrations/` | Schema, Policies und Funktionen |
| `tests/` | Datenbanktests (PGlite), Funktionstests, Browser-Check |

Einrichtung: [docs/SETUP.md](docs/SETUP.md)

## Entwickeln

```bash
npm install            # nur Test-Werkzeuge
npm test               # Datenbank- und Funktionstests, ca. 3 s
npm run check          # Syntax und Offline-Cache-Liste
npm run mock           # App mit Test-Datenbank im Browser: http://localhost:8787/?as=alex
npm run test:browser   # Klick-Durchlauf mit Screenshots (braucht: npm install --no-save playwright)
```

## Lizenz

MIT. Fremdbibliotheken: [vendor/LICENSES.md](vendor/LICENSES.md).
