import type { IncomingMessage, ServerResponse } from 'node:http';
import { validNoradId, validObserver } from '../src/providers/http';
import type { CatalogQuery, DataProvider, ValidationQuery } from '../src/providers/types';

type ProxyOptions = { allowRemote?: boolean; maxBodyBytes?: number };
const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
async function bodyOf(request: IncomingMessage, max: number): Promise<unknown> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) { const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += data.length; if (size > max) throw new Error('Request body too large'); chunks.push(data); }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('Invalid JSON request'); }
}
function send(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status; response.setHeader('Content-Type', 'application/json; charset=utf-8'); response.setHeader('Cache-Control', 'no-store'); response.end(JSON.stringify(value));
}
export function createProxyHandler(providers: DataProvider[], options: ProxyOptions = {}) {
  const registry = new Map(providers.map(provider => [provider.id, provider]));
  const max = options.maxBodyBytes ?? 8192;
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (!options.allowRemote) {
      const host = (request.headers.host ?? '').split(':')[0].toLowerCase();
      const address = request.socket.remoteAddress?.replace(/^::ffff:/, '');
      if (!localHosts.has(host) || !['::1', '127.0.0.1'].includes(address ?? '')) { send(response, 403, { error: 'Local-only proxy' }); return; }
    }
    if (request.method !== 'POST' || !request.url) { send(response, 405, { error: 'Method not allowed' }); return; }
    const match = /^\/([a-z0-9]+)\/(catalog|orbital|validation)$/.exec(request.url);
    if (!match) { send(response, 404, { error: 'Unknown proxy operation' }); return; }
    const [, providerId, operation] = match, provider = registry.get(providerId);
    if (!provider || !provider.capabilities[operation as keyof typeof provider.capabilities]) { send(response, 404, { error: 'Unsupported provider operation' }); return; }
    try {
      const input = await bodyOf(request, max);
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid request');
      let result: unknown;
      if (operation === 'catalog' || operation === 'orbital') {
        const query = input as CatalogQuery;
        if (query.noradId !== undefined && !validNoradId(query.noradId)) throw new Error('Invalid NORAD ID');
        if (query.query !== undefined && (typeof query.query !== 'string' || query.query.length > 80)) throw new Error('Invalid catalog query');
        result = operation === 'catalog' ? await provider.getCatalog(query) : await provider.getOrbitalData(query);
      } else {
        const query = input as ValidationQuery;
        if (!validNoradId(query.noradId) || typeof query.at !== 'string' || !Number.isFinite(Date.parse(query.at)) || !validObserver(query.observer)) throw new Error('Invalid validation request');
        result = await provider.getValidationPosition({ ...query, at: new Date(query.at) });
      }
      send(response, 200, result);
    } catch {
      // Never forward upstream bodies, exception messages, request payloads, or credential-bearing URLs.
      send(response, 400, { error: 'Proxy request failed validation or upstream operation' });
    }
  };
}
