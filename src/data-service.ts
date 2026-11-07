import { parseElements, type Elements, type Observer } from './orbit';
import { TTL_MS, type Storage } from './catalog';
import { UnsupportedOperationError, type CatalogQuery, type DataProvider, type ValidationPosition } from './providers/types';
import { comparePosition, type ValidationRow } from './validation';
export type { DataProvider } from './providers/types';
import { UpstreamHttpError, validNoradId } from './providers/http';
import { supportsIssOrbitalQuery } from './providers/wheretheiss';

export type DataResult = { elements: Elements[]; fetchedAt: number; elementEpoch: string; provider: string; source: 'network' | 'cache' | 'stale-cache'; ageMs: number; warning?: string };
export type RateLimit = { requests: number; windowMs: number };
export type ServiceOptions = { providers: DataProvider[]; storage: Storage; now?: () => number; sleep?: (ms: number) => Promise<void>; maxRetries?: number; ttlMs?: number; retryBaseMs?: number; maxWaitMs?: number; rateLimits?: Record<string, RateLimit | RateLimit[]> };
type CacheRecord = { identity: string; fetchedAt: number; provider: string; elements: unknown[] };
type Flight = { controller: AbortController; waiters: number; settled: boolean; promise: Promise<DataResult> };
const STARLINK_PAUSE_KEY = 'satellite-tracker:celestrak-starlink:retry-at:v1';
const STARLINK_PAUSE_MS = 2 * 60 * 60 * 1000;

export class StarlinkDownloadPausedError extends Error {
  constructor(readonly retryAt: number) {
    super('CelesTrak Starlink download paused after HTTP 403');
    this.name = 'StarlinkDownloadPausedError';
  }
}

function identity(op: 'catalog' | 'orbital', query: CatalogQuery): string { return JSON.stringify({ op, group: query.group ?? 'stations', noradId: op === 'orbital' ? query.noradId ?? null : null }); }
function cacheKey(id: string): string { return `satellite-tracker:data:v1:${id}`; }
function acceptsProviderForGroup(provider: string, op: 'catalog' | 'orbital', query: CatalogQuery): boolean {
  return provider !== 'wheretheiss' || (op === 'orbital' && supportsIssOrbitalQuery(query));
}
function parseCache(raw: string | null, id: string, now: number): { fetchedAt: number; provider: string; elements: Elements[] } | undefined {
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as CacheRecord;
    if (value.identity !== id || !Number.isFinite(value.fetchedAt) || value.fetchedAt > now || typeof value.provider !== 'string' || !Array.isArray(value.elements)) return undefined;
    return { fetchedAt: value.fetchedAt, provider: value.provider, elements: value.elements.map(parseElements) };
  } catch { return undefined; }
}
function filter(rows: Elements[], query: CatalogQuery): Elements[] {
  const term = query.query?.trim().toLowerCase();
  return rows.filter(row => (query.noradId === undefined || row.NORAD_CAT_ID === query.noradId) && (!term || row.OBJECT_NAME.toLowerCase().includes(term) || String(row.NORAD_CAT_ID).includes(term)));
}
function abortError(): Error { return Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }); }
function validateOptions(options: ServiceOptions): void {
  const integer = (n: number | undefined, fallback: number, min: number, max: number) => Number.isInteger(n ?? fallback) && (n ?? fallback) >= min && (n ?? fallback) <= max;
  const finite = (n: number | undefined, fallback: number, min: number) => Number.isFinite(n ?? fallback) && (n ?? fallback) >= min;
  if (!integer(options.maxRetries, 2, 0, 5) || !finite(options.ttlMs, TTL_MS, 1) || !finite(options.retryBaseMs, 250, 0) || !finite(options.maxWaitMs, 2000, 0)) throw new Error('Invalid service options');
  for (const value of Object.values(options.rateLimits ?? {})) for (const limit of Array.isArray(value) ? value : [value]) {
    if (!Number.isInteger(limit.requests) || limit.requests < 1 || !Number.isFinite(limit.windowMs) || limit.windowMs <= 0) throw new Error('Invalid service options');
  }
}
export function createDataService(options: ServiceOptions) {
  validateOptions(options);
  const now = options.now ?? Date.now, sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const ttl = options.ttlMs ?? TTL_MS, maxRetries = options.maxRetries ?? 2, retryBase = options.retryBaseMs ?? 250, maxWait = options.maxWaitMs ?? 2000;
  const inFlight = new Map<string, Flight>(), windows = new Map<string, number[]>(), rateQueues = new Map<string, Promise<void>>();
  let starlinkRetryAt = 0;
  const defaults: Record<string, RateLimit[]> = {
    celestrak: [{ requests: 1, windowMs: 2 * 60 * 60 * 1000 }], spacetrack: [{ requests: 29, windowMs: 60_000 }, { requests: 299, windowMs: 60 * 60 * 1000 }],
    n2yo: [{ requests: 999, windowMs: 60 * 60 * 1000 }], wheretheiss: [{ requests: 1, windowMs: 1000 }],
  };
  async function wait(ms: number, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (ms > maxWait) throw new Error('Provider wait exceeds configured maximum');
    if (ms === 0) return;
    await new Promise<void>((resolve, reject) => {
      const aborted = () => { signal.removeEventListener('abort', aborted); reject(abortError()); };
      signal.addEventListener('abort', aborted, { once: true });
      sleep(ms).then(() => { signal.removeEventListener('abort', aborted); resolve(); }, error => { signal.removeEventListener('abort', aborted); reject(error); });
    });
    signal.throwIfAborted();
  }
  async function rateLimit(id: string, signal: AbortSignal): Promise<void> {
    const configured = options.rateLimits?.[id], limits = configured ? Array.isArray(configured) ? configured : [configured] : defaults[id] ?? [];
    if (!limits.length) return;
    const previous = rateQueues.get(id) ?? Promise.resolve();
    let release!: () => void;
    const turn = new Promise<void>(resolve => { release = resolve; });
    const tail = previous.catch(() => {}).then(() => turn); rateQueues.set(id, tail);
    try {
      await new Promise<void>((resolve, reject) => {
        const aborted = () => { signal.removeEventListener('abort', aborted); reject(abortError()); };
        signal.addEventListener('abort', aborted, { once: true });
        previous.catch(() => {}).then(() => { signal.removeEventListener('abort', aborted); resolve(); });
      });
      signal.throwIfAborted();
      let stamp = now(), history = windows.get(id) ?? [];
      const delay = Math.max(0, ...limits.map(limit => { const recent = history.filter(t => stamp - t < limit.windowMs); return recent.length >= limit.requests ? recent[0] + limit.windowMs - stamp : 0; }));
      if (delay > 0) { if (delay > maxWait) throw new Error('Provider wait exceeds configured maximum'); await wait(delay, signal); stamp = now(); history = history.filter(t => stamp - t < Math.max(...limits.map(limit => limit.windowMs))); }
      windows.set(id, [...history, stamp]);
    } finally { release(); if (rateQueues.get(id) === tail) rateQueues.delete(id); }
  }
  async function withRetry<T>(provider: DataProvider, fn: () => Promise<T>, signal: AbortSignal): Promise<T> {
    let error: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try { signal.throwIfAborted(); await rateLimit(provider.id, signal); signal.throwIfAborted(); return await fn(); }
      catch (caught) {
        error = caught; if (signal.aborted || attempt === maxRetries) throw caught;
        const status = typeof caught === 'object' && caught !== null && 'status' in caught ? Number((caught as { status: unknown }).status) : undefined;
        const transient = status === 429 || (status !== undefined && status >= 500 && status <= 599) ||
          status === undefined && (caught instanceof TypeError || caught instanceof Error && caught.name === 'AbortError');
        if (!transient) throw caught;
        const retryAfter = typeof caught === 'object' && caught !== null && 'retryAfterMs' in caught ? Number((caught as { retryAfterMs: unknown }).retryAfterMs) : undefined;
        await wait(Math.min(maxWait + 1, retryAfter ?? retryBase * 2 ** attempt), signal);
      }
    }
    throw error;
  }
  function result(elements: Elements[], fetchedAt: number, provider: string, source: DataResult['source'], stamp: number): DataResult {
    const epoch = elements.length ? elements.reduce((best, row) => Date.parse(row.EPOCH) > Date.parse(best) ? row.EPOCH : best, elements[0].EPOCH) : '';
    return { elements, fetchedAt, elementEpoch: epoch, provider, source, ageMs: Math.max(0, stamp - fetchedAt) };
  }
  async function perform(op: 'catalog' | 'orbital', query: CatalogQuery, id: string, flight: Flight): Promise<DataResult> {
    const key = cacheKey(id), signal = flight.controller.signal, stamp = now();
    let cached: ReturnType<typeof parseCache>;
    try { cached = parseCache(await options.storage.getItem(key), id, stamp); } catch { cached = undefined; }
    if (cached && !acceptsProviderForGroup(cached.provider, op, query)) cached = undefined;
    if (cached && stamp - cached.fetchedAt < ttl) return result(cached.elements, cached.fetchedAt, cached.provider, 'cache', stamp);
    const starlinkGroup = query.group === 'starlink' && (op === 'catalog' || query.noradId === undefined);
    let pause: StarlinkDownloadPausedError | undefined;
    let last: unknown;
    for (const provider of options.providers) {
      if (!provider.capabilities[op] || !acceptsProviderForGroup(provider.id, op, query)) continue;
      const celestrakStarlink = starlinkGroup && provider.id === 'celestrak';
      if (celestrakStarlink) {
        try {
          const saved = Number(await options.storage.getItem(STARLINK_PAUSE_KEY));
          if (Number.isFinite(new Date(saved).getTime())) starlinkRetryAt = Math.max(starlinkRetryAt, saved);
        } catch { /* Keep the in-memory pause if persistence is unavailable. */ }
        signal.throwIfAborted();
        if (starlinkRetryAt > now()) {
          pause = new StarlinkDownloadPausedError(starlinkRetryAt);
          continue;
        }
      }
      try {
        const providerQuery: CatalogQuery = { group: query.group ?? 'stations', ...(op === 'orbital' ? { noradId: query.noradId } : {}), signal };
        const rows = await withRetry(provider, () => op === 'catalog' ? provider.getCatalog(providerQuery) : provider.getOrbitalData(providerQuery), signal);
        if (!Array.isArray(rows) || !rows.length) throw new Error('Provider returned an empty catalog');
        const elements = rows.map(parseElements); signal.throwIfAborted();
        const body: CacheRecord = { identity: id, fetchedAt: now(), provider: provider.id, elements };
        let cacheWarning: string | undefined;
        try { await options.storage.setItem(key, JSON.stringify(body)); } catch { cacheWarning = 'Fresh data loaded, but offline cache could not be saved.'; }
        return { ...result(elements, body.fetchedAt, provider.id, 'network', now()), warning: cacheWarning };
      } catch (error) {
        if (signal.aborted) throw error;
        last = error;
        if (celestrakStarlink && error instanceof UpstreamHttpError && error.status === 403) {
          const rejectedAt = now();
          const retryAfter = rejectedAt + (error.retryAfterMs ?? 0);
          const safeRetryAfter = Number.isFinite(new Date(retryAfter).getTime()) ? retryAfter : rejectedAt;
          starlinkRetryAt = Math.max(starlinkRetryAt, rejectedAt + STARLINK_PAUSE_MS, safeRetryAfter);
          pause = new StarlinkDownloadPausedError(starlinkRetryAt);
          try { await options.storage.setItem(STARLINK_PAUSE_KEY, String(starlinkRetryAt)); } catch { /* Keep the in-memory pause. */ }
        }
      }
    }
    if (cached) return { ...result(cached.elements, cached.fetchedAt, cached.provider, 'stale-cache', now()), warning: 'Refresh failed; showing previously validated offline orbital data.' };
    throw pause ?? last ?? new Error(`No provider supports ${op}`);
  }
  function load(op: 'catalog' | 'orbital', query: CatalogQuery = {}): Promise<DataResult> {
    if (query.noradId !== undefined && !validNoradId(query.noradId)) return Promise.reject(new Error('Invalid NORAD ID'));
    if (query.signal?.aborted) return Promise.reject(abortError());
    const id = identity(op, query);
    let flight = inFlight.get(id);
    if (!flight) {
      flight = { controller: new AbortController(), waiters: 0, settled: false, promise: Promise.resolve(undefined as never) };
      const current = flight;
      current.promise = perform(op, query, id, current).finally(() => { current.settled = true; if (inFlight.get(id) === current) inFlight.delete(id); });
      inFlight.set(id, current);
    }
    flight.waiters++;
    const current = flight;
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = () => { if (done) return false; done = true; query.signal?.removeEventListener('abort', aborted); current.waiters--; if (!current.waiters && !current.settled) { current.controller.abort(); if (inFlight.get(id) === current) inFlight.delete(id); } return true; };
      const aborted = () => { if (finish()) reject(abortError()); };
      query.signal?.addEventListener('abort', aborted, { once: true });
      current.promise.then(value => { if (finish()) resolve({ ...value, elements: filter(value.elements, query) }); }, error => { if (finish()) reject(error); });
    });
  }
  return {
    getCatalog(query?: CatalogQuery) { return load('catalog', query); },
    getOrbitalData(query?: CatalogQuery) { return load('orbital', query); },
    async validate(noradId: number, at: Date, observer: Observer, elements?: Elements[], signal?: AbortSignal): Promise<ValidationRow[]> {
      if (!validNoradId(noradId) || !Number.isFinite(at.getTime())) throw new Error('Invalid validation request');
      signal?.throwIfAborted();
      const orbital = elements?.map(parseElements) ?? (await load('orbital', { noradId, signal })).elements;
      const element = orbital.find(row => row.NORAD_CAT_ID === noradId); if (!element) throw new Error('No matching orbital elements for validation');
      const epoch = Date.parse(element.EPOCH); if (!Number.isFinite(epoch) || epoch > now()) throw new Error('Invalid or future orbital epoch');
      const rows: ValidationRow[] = [];
      for (const provider of options.providers) {
        if (!provider.capabilities.validation || provider.id === 'wheretheiss' && noradId !== 25544) continue;
        signal?.throwIfAborted();
        const position = await withRetry(provider, () => provider.getValidationPosition({ noradId, at, observer, signal }), signal ?? new AbortController().signal);
        rows.push(comparePosition(element, position, at, observer, provider.id, now()));
      }
      if (!rows.length) throw new UnsupportedOperationError('validation', 'validation');
      return rows;
    },
  };
}
