// Fehler aus Datenbank und Netz in kurze deutsche Sätze übersetzen.
// Die Datenbankfunktionen werfen feste Kürzel (siehe supabase/migrations/0002_functions.sql).
const ERRORS = {
  not_signed_in: 'Bitte melde dich an.',
  no_access: 'Kein Zugriff auf diesen Haushalt.',
  admin_only: 'Das darf nur ein Admin.',
  invite_invalid: 'Die Einladung ist abgelaufen, schon benutzt oder falsch.',
  label_taken: 'Dieses Etikett ist schon vergeben.',
  name_required: 'Bitte einen Namen eingeben.',
  last_admin: 'Der letzte Admin kann nicht entfernt werden.',
  bad_request: 'Ungültige Eingabe.',
  cycle: 'Das geht nicht: Es würde in sich selbst stecken.',
  parent_single: 'In ein Einzelstück kann nichts hinein.',
  type_needs_parent: 'Erst einen Ort wählen: Der Inhalt braucht einen Platz.',
  already_returned: 'Diese Ausleihe ist schon zurückgegeben.',
  photo_limit: 'Höchstens 8 Fotos pro Kiste.',
  storage_limit: 'Der Fotospeicher dieses Haushalts ist voll. Bitte alte Fotos löschen.',
  storage_full: 'Der Fotospeicher der App ist gerade voll. Bitte später erneut versuchen.',
  clipboard_unavailable: 'Dieser Browser gibt die Zwischenablage nicht frei. Bitte in das Feld tippen, lange drücken und „Einfügen“ wählen.',
  clipboard_empty: 'In der Zwischenablage ist kein Bild. Erst lange auf den Gegenstand drücken und „Auswahl kopieren“ wählen.',
  photo_unreadable: 'Das Bild ließ sich nicht lesen. Bitte ein anderes Foto wählen.',
  'exceeded the maximum allowed size': 'Das Foto ist zu groß.',
  'Failed to fetch': 'Keine Verbindung. Bitte später erneut versuchen.'
};

export function errorText(e) {
  const msg = String(e?.message ?? e ?? '');
  const key = Object.keys(ERRORS).find(k => msg.includes(k));
  if (key) return ERRORS[key];
  if (/otp|token.*(expired|invalid)/i.test(msg)) return 'Der Code ist falsch oder abgelaufen.';
  if (/rate limit|security purposes/i.test(msg)) return 'Zu viele Versuche. Bitte kurz warten.';
  return 'Etwas ist schiefgelaufen: ' + msg;
}
