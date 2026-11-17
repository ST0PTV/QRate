# Einrichtung

Dauer: etwa 20 Minuten. Kosten: die kostenlosen Stufen von Supabase und GitHub Pages reichen für einen Haushalt.

## 1. Supabase-Projekt anlegen

1. Auf [supabase.com](https://supabase.com) ein Konto anlegen und ein neues Projekt erstellen.
2. Region: **Central EU (Frankfurt)**.
3. Das Datenbank-Passwort sicher aufbewahren. Die App braucht es nicht.

## 2. Datenbank einrichten

Im Projekt unter **SQL Editor** nacheinander den Inhalt dieser Dateien einfügen und ausführen:

1. `supabase/migrations/0001_schema.sql` – Tabellen, Regeln, Rechte
2. `supabase/migrations/0002_functions.sql` – Funktionen für Scan, Etiketten, Einladungen, Suche
3. `supabase/migrations/0003_photos.sql` – Fotos pro Kiste (privater Speicher `box-photos`)
4. `supabase/migrations/0004_item_photos.sql` – ein Foto pro Gegenstand (PNG erlaubt)
5. `supabase/migrations/0005_things.sql` – neutrale Etiketten, Typen, Dinge ineinander (übernimmt bestehende Orte)
6. `supabase/migrations/0006_lending.sql` – Ausleihen mit Personen und Erinnerung
7. `supabase/migrations/0007_lending_privacy.sql` – gelöschte Personen verschwinden auch aus dem Verlauf; Rückgaben lassen sich nicht wieder öffnen

Alle müssen ohne Fehler durchlaufen, in dieser Reihenfolge. 0005 entfernt nach dem Umkopieren die alte Tabelle der Orte; Supabase warnt deshalb vor dem Ausführen. Am sichersten läuft eine Datei zwischen `begin;` und `commit;`. Spätere Änderungen kommen als neue Dateien dazu und werden genauso ausgeführt.

## 3. Anmeldung einstellen

Unter **Authentication**:

1. **Sign In / Providers → Email:** aktiviert lassen.
2. **URL Configuration:**
   - *Site URL:* die App-Adresse, z. B. `https://st0ptv.github.io/QRate/`
   - *Redirect URLs:* dieselbe Adresse und für lokale Tests `http://localhost:8787/`
3. **Emails → SMTP Settings:** eigenen Mailversand eintragen. Ohne ihn schickt Supabase nur an Adressen des eigenen Supabase-Teams, und die Vorlagen lassen sich nicht bearbeiten. Kostenlos geht das z. B. mit [Brevo](https://www.brevo.com) (300 Mails pro Tag):
   - Bei Brevo unter *Senders* eine Absenderadresse anlegen und bestätigen.
   - Unter *SMTP & API → SMTP* einen Standard-Schlüssel erzeugen (wird nur einmal angezeigt).
   - In Supabase: Host `smtp-relay.brevo.com`, Port `587`, Username = SMTP-Login von Brevo, Password = der Schlüssel, Sender = die bestätigte Adresse, Name `QRate`.
4. **Emails → Templates → Magic link or OTP:** den Code in die Mail aufnehmen, damit die Anmeldung auch in der installierten Homescreen-App funktioniert. Zum Beispiel:

   ```html
   <h2>Dein QRate-Code</h2>
   <p>Code: <strong>{{ .Token }}</strong></p>
   <p>Oder direkt anmelden: <a href="{{ .ConfirmationURL }}">Anmelden</a></p>
   ```

   Dasselbe Template unter **Confirm sign up** eintragen, das bekommen neue Nutzer bei der ersten Anmeldung.

Hinweis: Im kostenlosen Tarif pausiert Supabase ein Projekt nach etwa einer Woche ohne Nutzung. Dann im Dashboard auf **Resume project** klicken; die Daten bleiben erhalten, die Wiederherstellung dauert einige Minuten.

## 4. App verbinden

Unter **Project Settings → API** stehen *Project URL* und der öffentliche Schlüssel (*anon* bzw. *publishable*). Beide in `js/core/config.js` eintragen:

```js
SUPABASE_URL: 'https://xxxx.supabase.co',
SUPABASE_ANON_KEY: '…',
APP_URL: 'https://st0ptv.github.io/QRate/'
```

Dieselbe *Project URL* in `index.html` im Sicherheitskopf (`Content-Security-Policy`) bei `img-src` und `connect-src` eintragen. Sonst blockiert der Browser die Verbindung zu Supabase. `npm run check` meldet, wenn beide Adressen nicht zusammenpassen.

Der öffentliche Schlüssel darf ins Repo, er ist für Browser gedacht. Geschützt sind die Daten über die Policies aus Schritt 2. Den *service_role*- bzw. *secret*-Schlüssel nie eintragen.

**`APP_URL` vor dem ersten Etikettendruck festlegen.** Diese Adresse steht in jedem QR-Code. Wird sie später geändert, funktionieren gedruckte Etiketten nicht mehr.

## 5. Veröffentlichen

1. Repo auf GitHub anlegen (z. B. `QRate`) und pushen.
2. **Settings → Pages:** Branch `main`, Ordner `/ (root)`.
3. Nach ein bis zwei Minuten ist die App unter `APP_URL` erreichbar.

## 6. Erster Start

1. App auf dem Handy öffnen, mit E-Mail anmelden, Haushalt gründen.
2. In Safari: Teilen → **Zum Home-Bildschirm**. In der installierten App über den Reiter **Scannen** scannen. Die normale Kamera öffnet Links in Safari, das funktioniert auch, ist aber eine eigene Anmeldung.
3. **Etiketten → 24 Kisten-Etiketten → Druckansicht → Drucken.** Vorher einen Probedruck auf Normalpapier gegen den Bogen halten und bei Bedarf den Versatz anpassen.
4. Mitglieder unter **Haushalt → Einladung erzeugen** einladen und danach bestätigen.
