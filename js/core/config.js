// Einstellungen pro Installation. Die Werte des Supabase-Projekts stehen unter
// Supabase → Project Settings → API. Der "anon"-Schlüssel ist öffentlich; geschützt wird über Row-Level-Security.
export const CONFIG = {
  SUPABASE_URL: 'https://sstjypgcpxrlfyqezoky.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_PoXX0USBchbqCm2ez-_qbQ_eDB9xNy3',
  // Adresse, die in jeden QR-Code gedruckt wird. Vor dem ersten Etikettendruck festlegen und danach nicht mehr ändern.
  APP_URL: 'https://st0ptv.github.io/QRate/'
};

export const isConfigured = () => Boolean(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);
