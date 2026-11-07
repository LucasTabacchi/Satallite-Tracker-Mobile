import { createDataService, type DataResult } from '../src/data-service';
import { TTL_MS, type Storage } from '../src/catalog';
import { track, type Observer } from '../src/orbit';
import { calculateFootprint, generateGroundTrack, type GroundTrack } from '../src/geometry';
import { CelesTrakProvider } from '../src/providers/celestrak';
import { WhereTheIssProvider } from '../src/providers/wheretheiss';
import type { Fetcher } from '../src/providers/http';
import { json2satrec, propagate } from 'satellite.js';

export const UPDATE_MS = 2000;
export const OBSERVER: Observer = { latitude: -34.6037, longitude: -58.3816, altitudeKm: .025 };
const ALLOWED_IDS = [25544, 20580, 44713, 48274];
const REFRESH_BACKOFF_MS = 2 * 60 * 60 * 1000;

export function projectCoordinate(latitude: number, longitude: number) {
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) throw new Error('Invalid map coordinates');
  return { x: (longitude + 180) / 360 * 1000, y: (90 - latitude) / 180 * 550 };
}

export function buildLiveFrame(data: DataResult, at: Date, groundTrack?: GroundTrack) {
  const elements = data.elements[0];
  if (!elements) throw new Error('No orbital elements');
  const position = track(elements, at, OBSERVER);
  const state = propagate(json2satrec(elements), at);
  if (!state || !state.velocity) throw new Error('No orbital velocity');
  const speedKmS = Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z);
  if (!Number.isFinite(speedKmS)) throw new Error('Invalid orbital velocity');
  return {
    noradId: elements.NORAD_CAT_ID, name: elements.OBJECT_NAME, at: at.toISOString(),
    position, point: projectCoordinate(position.latitude, position.longitude), speedKmS,
    periodMinutes: 1440 / Number(elements.MEAN_MOTION), inclination: Number(elements.INCLINATION),
    epoch: elements.EPOCH, epochAgeMs: at.getTime() - Date.parse(elements.EPOCH),
    fetchedAt: data.fetchedAt, fetchAgeMs: Math.max(0, at.getTime() - data.fetchedAt),
    provider: data.provider, source: data.source, warning: data.warning,
    groundTrack: groundTrack ?? generateGroundTrack(elements, at),
    footprint: calculateFootprint(position.altitudeKm, 0, position.latitude, position.longitude),
  };
}
export type LiveFrame = ReturnType<typeof buildLiveFrame>;
export type MapEvent = { status: 'loading' | 'error'; noradId: number } | { status: 'ready'; frame: LiveFrame };
type Options = {
  load: (id: number, signal: AbortSignal) => Promise<DataResult>;
  emit: (event: MapEvent) => void;
  now?: () => number;
  setTimer?: (fn: () => void, delay: number) => number;
  clearTimer?: (id: number) => void;
};

/** One timer and one selected request; a stale completion cannot regain ownership. */
export function createLiveMapController(options: Options) {
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? ((fn, delay) => globalThis.setInterval(fn, delay) as unknown as number);
  const clearTimer = options.clearTimer ?? (id => globalThis.clearInterval(id));
  let selected = 25544, active = false, disposed = false, revision = 0;
  let timer: number | undefined, request: AbortController | undefined, current: DataResult | undefined;
  let ground: GroundTrack | undefined, groundAt = 0, refreshAt = 0;

  function cancel() {
    revision++;
    request?.abort(); request = undefined;
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
  }
  function publish() {
    if (!active || disposed || !current) return;
    try {
      const stamp = now();
      if (!ground || Math.abs(stamp - groundAt) >= 60000) {
        ground = generateGroundTrack(current.elements[0], new Date(stamp)); groundAt = stamp;
      }
      options.emit({ status: 'ready', frame: buildLiveFrame(current, new Date(stamp), ground) });
    } catch {
      options.emit({ status: 'error', noradId: selected });
      cancel(); current = undefined;
    }
  }
  function ensureTimer() {
    if (active && !disposed && current && timer === undefined) timer = setTimer(() => {
      publish();
      if (current && now() >= refreshAt && !request) void load();
    }, UPDATE_MS);
  }
  async function load() {
    if (!active || disposed) return;
    const owner = ++revision, id = selected, controller = new AbortController();
    request?.abort(); request = controller;
    if (!current) options.emit({ status: 'loading', noradId: id });
    try {
      const result = await options.load(id, controller.signal);
      if (disposed || !active || owner !== revision || controller.signal.aborted) return;
      const element = result.elements.find(row => row.NORAD_CAT_ID === id);
      if (!element) throw new Error('Selected satellite missing');
      current = { ...result, elements: [element] }; ground = undefined;
      refreshAt = Math.max(result.fetchedAt + TTL_MS, now() + REFRESH_BACKOFF_MS);
      publish(); ensureTimer();
    } catch {
      if (disposed || !active || owner !== revision || controller.signal.aborted) return;
      refreshAt = now() + REFRESH_BACKOFF_MS;
      if (current) { current = { ...current, source: 'stale-cache', warning: 'Refresh failed' }; publish(); }
      else options.emit({ status: 'error', noradId: id });
    } finally { if (owner === revision) request = undefined; }
  }
  return {
    select(id: number) {
      if (disposed) return;
      if (!ALLOWED_IDS.includes(id)) throw new Error('Satellite not in map catalog');
      if (selected === id && (current || request)) return;
      cancel(); selected = id; current = undefined; ground = undefined;
      if (active) void load();
    },
    setActive(value: boolean) {
      if (disposed || value === active) return;
      active = value;
      if (!active) cancel();
      else if (current) { publish(); ensureTimer(); if (now() >= refreshAt) void load(); }
      else void load();
    },
    retry() { if (!request && active && !disposed) void load(); },
    dispose() { disposed = true; active = false; cancel(); current = undefined; },
  };
}

/** Each fixed dataset keeps the shared service's TTL, quota and cancellation rules. */
export function createBrowserLoader(storage: Storage, fetcher: Fetcher = fetch) {
  const services = new Map<number, ReturnType<typeof createDataService>>();
  const request: Fetcher = (url, init) => fetcher(url, { ...init, redirect: 'error' });
  return (id: number, signal: AbortSignal) => {
    if (!ALLOWED_IDS.includes(id)) return Promise.reject(new Error('Satellite not in map catalog'));
    let service = services.get(id);
    if (!service) {
      service = createDataService({ storage, maxRetries: 0, providers: [new CelesTrakProvider(request), ...(id === 25544 ? [new WhereTheIssProvider(request)] : [])] });
      services.set(id, service);
    }
    return service.getOrbitalData({ noradId: id, signal });
  };
}
