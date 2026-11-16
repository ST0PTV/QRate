# QRate

QR-Etiketten für alles im Haushalt: Räume, Regale, Kisten, Geräte. Etikett scannen, Inhalt und Ort sehen. Mehrere Mitglieder pro Haushalt, jeder Eintrag zeigt, wer ihn angelegt hat.

- **Etiketten:** alle gleich, fortlaufende Nummer (#0042) plus zufälliger 8-stelliger Code im QR. Druckbogen 70 × 37 mm, 24 pro A4. Ältere Bogen mit K-0042 und O-007 funktionieren weiter.
- **Erster Scan eines freien Etiketts:** „Was ist das?“ – 16 Typen in drei Gruppen (Orte und Möbel, Behälter, Einzelstücke). Danach Name, Ort und Inhalt per Schnelleingabe („3x Kugeln, Lichterkette“). Der Typ lässt sich später ändern.
- **Dinge ineinander:** Keller › Regal › Ebene › Kiste. Verschieben per Liste oder Scan, „Einräumen“ scannt alles, was an einen Ort kommt. Die Übersicht zeigt alles als Baum.
- **Fotos:** bis zu 8 pro Kiste und eins pro Gegenstand, freigestellt mit „Auswahl kopieren“ auf dem iPhone (kein Modell, nichts verlässt das Gerät außer dem Bild).
- **Ausleihen:** an Personen ohne App-Zugang (nur Name, Telefon optional), mit Erinnerung auf der Übersicht und als Kalendereintrag.
- **Suche:** tippfehlertolerant über Gegenstände, Kisten und Orte, mit Pfad.
- **Sicherheit:** Der QR-Code enthält nur den Zufallscode. Inhalte gibt die Datenbank nur angemeldeten, bestätigten Mitgliedern des Haushalts heraus (Row-Level-Security). Unbekannte und fremde Codes sehen gleich aus.

## Technik

Statische PWA ohne Build-Schritt (HTML, CSS, ES-Module), Daten und Login über [Supabase](https://supabase.com) (Postgres, E-Mail-Code). Hosting auf GitHub Pages.

| Ordner | Inhalt |
| --- | --- |
| `js/core/` | Supabase-Zugriff, Speicher, Codes, Schnelleingabe, Scanner, UI-Helfer |
| `js/features/` | Seiten: Anmeldung, Übersicht, Ding (Kiste, Ort, Gerät), Scannen, Suche, Etiketten, Haushalt |
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
