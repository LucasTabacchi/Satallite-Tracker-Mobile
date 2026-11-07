import { createServer } from 'node:http';
import type { Fetcher } from '../src/providers/http';
import type { DataProvider } from '../src/providers/types';
import { N2yoProvider, SpaceTrackProvider } from './providers';
import { createProxyHandler } from './proxy';

export const LOCAL_PROXY_HOST = '127.0.0.1';
export const LOCAL_PROXY_PORT = 4178;

export function createLocalProxy(env: Readonly<Record<string, string | undefined>>, request: Fetcher = fetch) {
  const identity = env.SPACETRACK_IDENTITY?.trim();
  const password = env.SPACETRACK_PASSWORD;
  const apiKey = env.N2YO_API_KEY?.trim();
  const providers: DataProvider[] = [];
  if (!apiKey || identity || password) {
    if (!identity) throw new Error('Set SPACETRACK_IDENTITY in the server environment.');
    if (!password) throw new Error('Set SPACETRACK_PASSWORD in the server environment.');
    providers.push(new SpaceTrackProvider({ identity, password }, request));
  }
  if (apiKey) providers.push(new N2yoProvider({ apiKey }, request));

  const handler = createProxyHandler(providers);
  return createServer((incoming, response) => {
    // Require JSON without enabling CORS, so cross-origin forms cannot trigger upstream requests.
    const mediaType = incoming.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
    if (incoming.method === 'POST' && mediaType !== 'application/json') {
      response.writeHead(415, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ error: 'Content-Type must be application/json' }));
      return;
    }
    void handler(incoming, response);
  });
}
