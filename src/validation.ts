import { track, type Elements, type Observer } from './orbit';
import type { ValidationPosition } from './providers/types';

export type ValidationRow = {
  provider: string; noradId: number; timestamp: string; orbitalEpoch: string; orbitalAgeMs: number;
  local: { latitude: number; longitude: number; altitudeKm: number };
  reference: { latitude: number; longitude: number; altitudeKm: number };
  errorKm: number; surfaceErrorKm: number; altitudeErrorKm: number;
};
const earthA = 6378.137, earthE2 = 6.69437999014e-3;
function ecef(lat: number, lon: number, height: number): [number, number, number] {
  const phi = lat * Math.PI / 180, lambda = lon * Math.PI / 180;
  const n = earthA / Math.sqrt(1 - earthE2 * Math.sin(phi) ** 2);
  return [(n + height) * Math.cos(phi) * Math.cos(lambda), (n + height) * Math.cos(phi) * Math.sin(lambda), (n * (1 - earthE2) + height) * Math.sin(phi)];
}
export function comparePosition(elements: Elements, reference: ValidationPosition, at: Date, observer: Observer, provider: string, now = Date.now()): ValidationRow {
  const id = elements.NORAD_CAT_ID, timestamp = at.getTime(), epoch = Date.parse(elements.EPOCH);
  if (reference.noradId !== id || reference.timestamp.getTime() !== timestamp || !Number.isFinite(timestamp) || !Number.isFinite(reference.timestamp.getTime())) throw new Error('Validation provider returned mismatched NORAD ID or timestamp');
  if (![reference.latitude, reference.longitude, reference.altitudeKm].every(Number.isFinite) || Math.abs(reference.latitude) > 90 || Math.abs(reference.longitude) > 180) throw new Error('Validation provider returned invalid coordinates');
  if (!Number.isFinite(epoch) || epoch > now) throw new Error('Invalid or future orbital epoch');
  const propagated = track(elements, at, observer);
  const local = { latitude: propagated.latitude, longitude: propagated.longitude, altitudeKm: propagated.altitudeKm };
  const referenceGeo = { latitude: reference.latitude, longitude: reference.longitude, altitudeKm: reference.altitudeKm };
  const own = ecef(local.latitude, local.longitude, local.altitudeKm), their = ecef(referenceGeo.latitude, referenceGeo.longitude, referenceGeo.altitudeKm);
  const surfaceOwn = ecef(local.latitude, local.longitude, 0), surfaceTheir = ecef(referenceGeo.latitude, referenceGeo.longitude, 0);
  return {
    provider, noradId: id, timestamp: at.toISOString(), orbitalEpoch: elements.EPOCH, orbitalAgeMs: now - epoch, local, reference: referenceGeo,
    errorKm: Math.hypot(own[0] - their[0], own[1] - their[1], own[2] - their[2]),
    surfaceErrorKm: Math.hypot(surfaceOwn[0] - surfaceTheir[0], surfaceOwn[1] - surfaceTheir[1], surfaceOwn[2] - surfaceTheir[2]),
    altitudeErrorKm: Math.abs(local.altitudeKm - referenceGeo.altitudeKm),
  };
}
