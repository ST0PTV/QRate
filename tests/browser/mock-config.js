// Testumgebung: gilt als eingerichtet, QR-Adressen zeigen auf den lokalen Server.
export const CONFIG = {
  SUPABASE_URL: 'mock',
  SUPABASE_ANON_KEY: 'mock',
  APP_URL: location.origin + '/'
};

export const isConfigured = () => true;
