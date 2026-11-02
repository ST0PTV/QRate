# Einrichtung

Dauer: etwa 20 Minuten. Kosten: die kostenlosen Stufen von Supabase und GitHub Pages reichen für einen Haushalt.

## 1. Supabase-Projekt anlegen

1. Auf [supabase.com](https://supabase.com) ein Konto anlegen und ein neues Projekt erstellen.
2. Region: **Central EU (Frankfurt)**.
3. Das Datenbank-Passwort sicher aufbewahren. Die App braucht es nicht.

## 2. Datenbank einrichten

Im Projekt unter **SQL Editor** nacheinander den Inhalt dieser Dateien einfügen und ausführen:

1. `supabase/migrations/0001_schema.sql`
2. `supabase/migrations/0002_functions.sql`

Beide müssen ohne Fehler durchlaufen. Spätere Änderungen kommen als neue Dateien (`0003_…`) dazu und werden genauso ausgeführt.

## 3. Anmeldung einstellen

Unter **Authentication**:

1. **Sign In / Providers → Email:** aktiviert lassen.
2. **URL Configuration:**
   - *Site URL:* die App-Adresse, z. B. `https://st0ptv.github.io/QRate/`
   - *Redirect URLs:* dieselbe Adresse und für lokale Tests `http://localhost:8787/`
3. **Emails → Templates → Magic Link:** den Code in die Mail aufnehmen, damit die Anmeldung auch in der installierten Homescreen-App funktioniert. Zum Beispiel:

   ```html
   <h2>Dein QRate-Code</h2>
   <p>Code: <strong>{{ .Token }}</strong></p>
   <p>Oder direkt anmelden: <a href="{{ .ConfirmationURL }}">Anmelden</a></p>
   ```

   Dasselbe Template unter **Confirm signup** eintragen, das bekommen neue Nutzer bei der ersten Anmeldung.

Hinweis: Der eingebaute Mailversand von Supabase schickt nur wenige Mails pro Stunde. Für einen Haushalt reicht das meistens; sonst unter **Emails → SMTP Settings** einen eigenen Mailserver eintragen.

## 4. App verbinden

Unter **Project Settings → API** stehen *Project URL* und der öffentliche Schlüssel (*anon* bzw. *publishable*). Beide in `js/core/config.js` eintragen:

```js
SUPABASE_URL: 'https://xxxx.supabase.co',
SUPABASE_ANON_KEY: '…',
APP_URL: 'https://st0ptv.github.io/QRate/'
```

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
