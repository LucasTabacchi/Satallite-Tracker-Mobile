import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProxyProvider } from '../src/providers/proxy-client';
import { createProxyHandler } from '../server/proxy';
import { UpstreamHttpError } from '../src/providers/http';

test('proxy adapter rejects insecure remote URLs and unsupported providers', () => {
  assert.throws(() => new ProxyProvider('celestrak', 'http://example.com'), /HTTPS or local HTTP/);
  assert.throws(() => new ProxyProvider('unknown', 'https://api.example.com'), /Unsupported/);
});
test('proxy handler allowlists provider operations and never exposes upstream errors', async () => {
  const provider = { id: 'n2yo', capabilities: { catalog: false, orbital: false, validation: true }, getCatalog: async () => [], getOrbitalData: async () => [], getValidationPosition: async () => { throw new Error('secret credential upstream response'); } };
  const handler = createProxyHandler([provider], { allowRemote: true });
  const headers: Record<string, string> = {};
  let body = '';
  const response = { statusCode: 0, setHeader: (key: string, value: string) => { headers[key] = value; }, end: (value: string) => { body = value; } } as never;
  await handler({ method: 'POST', url: '/n2yo/validation', headers: { host: 'example' }, socket: {}, [Symbol.asyncIterator]: async function* () { yield Buffer.from('{"noradId":25544,"at":"2026-01-01T00:00:00.000Z","observer":{"latitude":0,"longitude":0,"altitudeKm":0}}'); } } as never, response);
  assert.equal((response as { statusCode: number }).statusCode, 400);
  assert.ok(!body.includes('secret credential'));
});

test('proxy client forwards cancellation and retains structured retry metadata', async () => {
  const controller = new AbortController();
  let receivedSignal: AbortSignal | null | undefined;
  const provider = new ProxyProvider('celestrak', 'https://proxy.example.test', async (_url, init) => {
    receivedSignal = init?.signal;
    return new Response('secret body', { status: 429, headers: { 'Retry-After': '4' } });
  });
  await assert.rejects(provider.getCatalog({ signal: controller.signal }), error => {
    assert.ok(error instanceof UpstreamHttpError);
    assert.equal(error.status, 429);
    assert.equal(error.retryAfterMs, 4000);
    assert.equal(error.message.includes('secret'), false);
    return true;
  });
  assert.equal(receivedSignal, controller.signal);
});
