import type { Elements, Observer } from '../orbit';
import { parseElements } from '../orbit';
import { parseRetryAfter, UpstreamHttpError, validNoradId, validObserver, type Fetcher } from './http';
import { type CatalogQuery, type DataProvider, type ValidationPosition, type ValidationQuery } from './types';

export class ProxyProvider implements DataProvider {
  readonly id: string;
  readonly capabilities: { catalog: boolean; orbital: boolean; validation: boolean };
  private readonly origin: string;
  constructor(providerId: string, endpoint: string, private readonly request: Fetcher = fetch) {
    if (!/^(celestrak|spacetrack|n2yo|wheretheiss)$/.test(providerId)) throw new Error('Unsupported proxy provider');
    const url = new URL(endpoint);
    if (url.username || url.password || url.search || url.hash || !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname)))) throw new Error('Proxy endpoint must be HTTPS or local HTTP');
    this.id = providerId;
    this.capabilities = { catalog: providerId === 'celestrak' || providerId === 'spacetrack', orbital: true, validation: providerId === 'n2yo' || providerId === 'wheretheiss' };
    this.origin = url.origin + url.pathname.replace(/\/$/, '');
  }
  getCatalog(query?: CatalogQuery): Promise<Elements[]> { if (!this.capabilities.catalog) throw new Error(`Provider ${this.id} does not support catalog`); return this.call<Elements[]>('catalog', query && { group: query.group, query: query.query, noradId: query.noradId }, query?.signal).then(rows => rows.map(parseElements)); }
  getOrbitalData(query?: CatalogQuery): Promise<Elements[]> { if (!this.capabilities.orbital) throw new Error(`Provider ${this.id} does not support orbital`); return this.call<Elements[]>('orbital', query && { group: query.group, query: query.query, noradId: query.noradId }, query?.signal).then(rows => rows.map(parseElements)); }
  getValidationPosition(query: ValidationQuery): Promise<ValidationPosition> {
    if (!validNoradId(query.noradId) || !Number.isFinite(query.at.getTime()) || !validObserver(query.observer)) throw new Error('Invalid proxy validation request');
    if (!this.capabilities.validation) throw new Error(`Provider ${this.id} does not support validation`);
    return this.call<ValidationPosition>('validation', { noradId: query.noradId, at: query.at.toISOString(), observer: query.observer }, query.signal).then(value => ({ ...value, timestamp: new Date(value.timestamp) }));
  }
  private async call<T>(operation: string, input: unknown, signal?: AbortSignal): Promise<T> {
    const response = await this.request(`${this.origin}/${this.id}/${operation}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(input ?? {}), signal });
    signal?.throwIfAborted();
    if (!response.ok) throw new UpstreamHttpError(response.status, parseRetryAfter(response.headers.get('Retry-After')));
    try { return await response.json() as T; } catch { throw new Error('Proxy returned invalid JSON'); }
  }
}
