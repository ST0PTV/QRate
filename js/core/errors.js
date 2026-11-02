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
