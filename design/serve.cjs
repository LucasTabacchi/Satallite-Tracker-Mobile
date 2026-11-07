const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const files = new Map([
  ['/', ['index.html', 'text/html']], ['/index.html', ['index.html', 'text/html']],
  ['/preview.css', ['preview.css', 'text/css']], ['/preview.mjs', ['preview.mjs', 'text/javascript']],
  ['/preview-model.mjs', ['preview-model.mjs', 'text/javascript']],
  ['/live-map-view.mjs', ['live-map-view.mjs', 'text/javascript']],
]);
const modules = new Map([
  ['/live-map.js', 'design/live-map.ts'],
  ...['orbit', 'geometry', 'data-service', 'catalog', 'validation', 'providers/types', 'providers/http', 'providers/celestrak', 'providers/wheretheiss']
    .map(name => [`/src/${name}`, `src/${name}.ts`]),
]);
function createPreviewServer() {
  const compiled = new Map([...modules].map(([url, source]) => [url, ts.transpileModule(
    fs.readFileSync(path.join(__dirname, '..', source), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } },
  ).outputText]));
  return http.createServer((request, response) => {
    const url = (request.url || '/').split('?')[0];
    const entry = files.get(url);
    const module = compiled.get(url);
    const vendor = url === '/vendor/satellite.es.js';
    if ((!entry && !module && !vendor) || !['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(404); response.end('Not found'); return;
    }
    response.writeHead(200, { 'Content-Type': `${entry ? entry[1] : 'text/javascript'}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : module ?? fs.readFileSync(vendor
      ? path.join(__dirname, '..', 'node_modules/satellite.js/dist/satellite.es.js') : path.join(__dirname, entry[0])));
  });
}
module.exports = { createPreviewServer };
if (require.main === module) {
  createPreviewServer().listen(4177, '127.0.0.1', () => console.log('Orbit design preview: http://127.0.0.1:4177'));
}
