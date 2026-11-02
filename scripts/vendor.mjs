// Kopiert die beiden Fremdbibliotheken unverändert nach vendor/ (Lizenzen: vendor/LICENSES.md).
import { copyFileSync } from 'node:fs';
const files = [
  ['node_modules/@supabase/supabase-js/dist/umd/supabase.js', 'vendor/supabase.js'],
  ['node_modules/qrcode-generator/dist/qrcode.js', 'vendor/qrcode.js']
];
for (const [from, to] of files) { copyFileSync(from, to); console.log(`${from} -> ${to}`); }
