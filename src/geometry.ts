import { track, type Elements, type Observer } from './orbit';

export type GroundTrackPoint = { at: Date; latitude: number; longitude: number; altitudeKm: number };
export type GroundTrack = {
  start: Date;
  end: Date;
  periodSeconds: number;
  samples: GroundTrackPoint[];
  /** Segments are broken whenever adjacent longitudes cross the antimeridian. */
  segments: GroundTrackPoint[][];
};

const EARTH_RADIUS_KM = 6371.0088;
const radians = Math.PI / 180;
const degrees = 180 / Math.PI;

/** Samples a full orbit centered on `at`; GEO naturally receives a longer time span. */
export function generateGroundTrack(elements: Elements, at: Date, options: { stepSeconds?: number; maxSamples?: number } = {}): GroundTrack {
  const atMs = at?.getTime();
  const stepSeconds = options.stepSeconds ?? 45;
  const maxSamples = options.maxSamples ?? 2500;
  if (!Number.isFinite(atMs)) throw new Error('Invalid ground-track time');
  if (!Number.isFinite(stepSeconds) || stepSeconds < 30 || stepSeconds > 60) throw new Error('Ground-track step must be between 30 and 60 seconds');
  if (!Number.isSafeInteger(maxSamples) || maxSamples < 2 || maxSamples > 100_000) throw new Error('Invalid ground-track sample limit');
  const periodSeconds = 86_400 / Number(elements.MEAN_MOTION);
  if (!Number.isFinite(periodSeconds) || periodSeconds <= 0) throw new Error('Invalid orbital period');
  const count = Math.ceil(periodSeconds / stepSeconds) + 1;
  if (count > maxSamples) throw new Error(`Ground track exceeds sample limit (${maxSamples})`);
  const startMs = atMs - periodSeconds * 500;
  const endMs = atMs + periodSeconds * 500;
  const samples: GroundTrackPoint[] = [];
  const segments: GroundTrackPoint[][] = [];
  let segment: GroundTrackPoint[] = [];
  for (let index = 0; index < count; index++) {
    const timeMs = index === count - 1 ? endMs : startMs + (periodSeconds * 1000 * index) / (count - 1);
    const position = track(elements, new Date(timeMs), { latitude: 0, longitude: 0, altitudeKm: 0 });
    const point = { at: new Date(timeMs), latitude: position.latitude, longitude: position.longitude, altitudeKm: position.altitudeKm };
    const previous = samples.at(-1);
    if (previous && Math.abs(point.longitude - previous.longitude) > 180) {
      if (segment.length) segments.push(segment);
      segment = [];
    }
    segment.push(point);
    samples.push(point);
  }
  if (segment.length) segments.push(segment);
  return { start: new Date(startMs), end: new Date(endMs), periodSeconds, samples, segments };
}

export type Footprint = { angularRadiusDeg: number; groundRadiusKm: number; coordinates: Array<{ latitude: number; longitude: number }> };

/** Spherical Earth cap approximation; terrain, ellipsoid flattening and refraction are omitted. */
export function calculateFootprint(altitudeKm: number, minimumElevationDeg: number, centerLatitude: number, centerLongitude = 0, vertexCount = 72): Footprint {
  if (!Number.isFinite(altitudeKm) || altitudeKm < 0) throw new Error('Invalid footprint altitude');
  if (!Number.isFinite(minimumElevationDeg) || minimumElevationDeg < 0 || minimumElevationDeg >= 90) throw new Error('Invalid footprint elevation');
  if (!Number.isFinite(centerLatitude) || Math.abs(centerLatitude) > 90 || !Number.isFinite(centerLongitude) || Math.abs(centerLongitude) > 180) throw new Error('Invalid footprint center');
  if (!Number.isSafeInteger(vertexCount) || vertexCount < 8 || vertexCount > 360) throw new Error('Invalid footprint vertex count');
  const elevation = minimumElevationDeg * radians;
  const ratio = EARTH_RADIUS_KM / (EARTH_RADIUS_KM + altitudeKm);
  const argument = Math.min(1, Math.max(-1, ratio * Math.cos(elevation)));
  const angularRadius = Math.acos(argument) - elevation;
  const angularRadiusDeg = Math.max(0, angularRadius * degrees);
  const angularDistance = angularRadiusDeg * radians;
  const latitude1 = centerLatitude * radians;
  const longitude1 = centerLongitude * radians;
  const coordinates = Array.from({ length: vertexCount }, (_, index) => {
    const bearing = (index * 2 * Math.PI) / vertexCount;
    // At a geographic pole, the destination formula's longitude is singular.
    if (Math.abs(centerLatitude) === 90 && angularRadiusDeg > 0) {
      return {
        latitude: Math.sign(centerLatitude) * (90 - angularRadiusDeg),
        longitude: ((centerLongitude + bearing * degrees + 540) % 360) - 180,
      };
    }
    const latitude2 = Math.asin(Math.sin(latitude1) * Math.cos(angularDistance) + Math.cos(latitude1) * Math.sin(angularDistance) * Math.cos(bearing));
    const longitude2 = longitude1 + Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude1),
      Math.cos(angularDistance) - Math.sin(latitude1) * Math.sin(latitude2),
    );
    const longitude = ((longitude2 * degrees + 540) % 360) - 180;
    return { latitude: latitude2 * degrees, longitude };
  });
  return { angularRadiusDeg, groundRadiusKm: angularRadius * EARTH_RADIUS_KM, coordinates };
}

export type SkyProjection = { x: number; y: number; radius: number };

/** Unit-circle polar projection: north is up, east is right, and zenith is center. */
export function projectSkyPosition(azimuthDeg: number, elevationDeg: number): SkyProjection {
  if (!Number.isFinite(azimuthDeg) || azimuthDeg < 0 || azimuthDeg >= 360) throw new Error('Invalid sky-chart azimuth');
  if (!Number.isFinite(elevationDeg) || elevationDeg < 0 || elevationDeg > 90) throw new Error('Invalid sky-chart elevation');
  const azimuth = azimuthDeg * radians;
  const radius = (90 - elevationDeg) / 90;
  return { x: Math.sin(azimuth) * radius, y: -Math.cos(azimuth) * radius, radius };
}
