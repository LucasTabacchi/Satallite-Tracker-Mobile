import { parseObserver, track, type Elements, type Observer } from '../orbit';
import { projectSkyPosition } from '../geometry';
import type { PassWindow } from '../prediction';

export type ObserverFormValues = { latitude: string; longitude: string; altitudeMeters: string };
export type SkyTrackPoint = { at: Date; x: number; y: number; visible: boolean };

export function parseObserverForm(values: ObserverFormValues): Observer {
  return parseObserver(values.latitude, values.longitude, values.altitudeMeters);
}

export function formatLocalDateTime(value: Date, locale?: string): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error('Invalid date/time');
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(value);
}

/** Build a bounded chart path from local SGP4 samples, never from demo coordinates. */
export function createSkyTrack(elements: Elements, observer: Observer, pass: PassWindow, requestedSamples = 64): SkyTrackPoint[] {
  if (!Number.isSafeInteger(requestedSamples) || requestedSamples < 2) throw new Error('Sky chart needs at least two samples');
  const count = Math.min(requestedSamples, 100);
  const start = pass.aos?.at ?? pass.samples[0]?.at ?? pass.maximum.at;
  const end = pass.los?.at ?? pass.samples.at(-1)?.at ?? pass.maximum.at;
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) throw new Error('Invalid pass chart interval');
  return Array.from({ length: count }, (_, index) => {
    const at = new Date(start.getTime() + (end.getTime() - start.getTime()) * index / (count - 1));
    const position = track(elements, at, observer);
    const visible = position.elevationDeg >= 0;
    const projected = projectSkyPosition(position.azimuthDeg, Math.max(0, Math.min(90, position.elevationDeg)));
    return { at, x: projected.x, y: projected.y, visible };
  });
}
