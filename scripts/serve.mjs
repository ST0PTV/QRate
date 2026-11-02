// Kleiner statischer Server für lokale Entwicklung und Browser-Checks.
// Aufruf: node scripts/serve.mjs [port] [--mock]
//   ohne --mock: die echte App (braucht config.js)
//   mit --mock:  Testumgebung mit PGlite-Datenbank und Beispieldaten; Nutzer wählen mit ?as=alex|robin|neu|fremd|none
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const PORT = Number(process.env.PORT || 8787);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.data': 'application/octet-stream',
  '.sql': 'text/plain; charset=utf-8', '.tar.gz': 'application/gzip', '.gz': 'application/gzip'
};

export function serve(port = PORT, { mock = false } = {}) {
  const server = createServer(async (req, res) => {
    try {
      let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
      if (path.includes('..')) throw new Error('verboten');
      // Testumgebung: die echte index.html mit Import-Map auf die PGlite-Schnittstelle (nur mit mock: true)
      if (mock && (path === '' || path === 'index.html')) {
        const html = (await readFile(join(ROOT, 'index.html'), 'utf8')).replace('<head>', `<head>
  <script type="importmap">{"imports":{"/js/core/api.js":"/tests/browser/mock-api.js","/js/core/config.js":"/tests/browser/mock-config.js"}}</script>`);
        res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-store' });
        res.end(html);
        return;
      }
      let file = join(ROOT, path);
      if ((await stat(file).catch(() => null))?.isDirectory()) file = join(file, 'index.html');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('nicht gefunden');
    }
  });
  return new Promise(ok => server.listen(port, () => ok(server)));
}

if (/[\\/]scripts[\\/]serve\.mjs$/.test(process.argv[1] ?? '')) {
  const mock = process.argv.includes('--mock');
  serve(Number(process.argv.find(a => /^\d+$/.test(a)) || PORT), { mock })
    .then(s => console.log(`http://localhost:${s.address().port}/${mock ? ' (Testumgebung)' : ''}`));
}
