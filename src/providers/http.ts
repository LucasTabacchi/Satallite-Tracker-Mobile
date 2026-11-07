export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export class UpstreamHttpError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;
  constructor(status: number, retryAfterMs?: number) {
    super(`Upstream request failed (${status})`);
    this.name = 'UpstreamHttpError'; this.status = status; this.retryAfterMs = retryAfterMs;
  }
}
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : undefined;
}
async function readUpstream<T>(request: Fetcher, url: string, accept: string, read: (response: Response) => Promise<T>, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await request(url, { signal: controller.signal, headers: { Accept: accept } });
    signal?.throwIfAborted();
    if (!response.ok) throw new UpstreamHttpError(response.status, parseRetryAfter(response.headers.get('Retry-After')));
    return await read(response);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
export function getJson<T>(request: Fetcher, url: string, signal?: AbortSignal): Promise<T> {
  return readUpstream(request, url, 'application/json', async response => {
    try { return await response.json() as T; } catch { throw new Error('Upstream returned invalid JSON'); }
  }, signal);
}
export function getCsv(request: Fetcher, url: string, signal?: AbortSignal): Promise<string> {
  return readUpstream(request, url, 'text/csv', response => response.text(), signal);
}
export function validNoradId(id: number): boolean { return Number.isSafeInteger(id) && id > 0 && id <= 999_999_999; }
export function validObserver(observer: { latitude: number; longitude: number; altitudeKm: number }): boolean {
  return [observer.latitude, observer.longitude, observer.altitudeKm].every(Number.isFinite) && Math.abs(observer.latitude) <= 90 && Math.abs(observer.longitude) <= 180 && observer.altitudeKm >= -1;
}
