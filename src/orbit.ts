import { degreesLat, degreesLong, ecfToLookAngles, eciToEcf, eciToGeodetic, gstime, json2satrec, propagate, type OMMJsonObject } from 'satellite.js';

export type Elements = OMMJsonObject & { NORAD_CAT_ID: number };
export type Observer = { latitude: number; longitude: number; altitudeKm: number };
const radians = Math.PI / 180;
export function parseObserver(latitude: string, longitude: string, altitudeMeters: string): Observer {
  const inputs = [latitude, longitude, altitudeMeters];
  const [lat, lon, height] = inputs.map(Number);
  if (inputs.some(value => !value.trim()) || ![lat, lon, height].every(Number.isFinite) ||
      Math.abs(lat) > 90 || Math.abs(lon) > 180 || height < -1000) throw new Error('Invalid observer coordinates');
  return { latitude: lat, longitude: lon, altitudeKm: height / 1000 };
}
const fields = ['NORAD_CAT_ID', 'MEAN_MOTION', 'ECCENTRICITY', 'INCLINATION', 'RA_OF_ASC_NODE', 'ARG_OF_PERICENTER', 'MEAN_ANOMALY', 'BSTAR', 'MEAN_MOTION_DOT', 'MEAN_MOTION_DDOT', 'ELEMENT_SET_NO'] as const;

export function parseElements(value: unknown): Elements {
  if (!value || typeof value !== 'object') throw new Error('Invalid OMM object');
  const row = { ...value } as Record<string, unknown>;
  for (const field of fields) {
    const value = row[field];
    if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '' || !Number.isFinite(Number(value))) {
      throw new Error(`Invalid OMM field: ${field}`);
    }
    row[field] = Number(value);
  }
  for (const [key, expected] of Object.entries({ CENTER_NAME: 'EARTH', REF_FRAME: 'TEME', TIME_SYSTEM: 'UTC', MEAN_ELEMENT_THEORY: 'SGP4' })) {
    if (row[key] !== undefined && row[key] !== expected) throw new Error(`Invalid OMM convention: ${key}`);
  }
  if (row.EPHEMERIS_TYPE !== undefined && row.EPHEMERIS_TYPE !== 0 && row.EPHEMERIS_TYPE !== '0') throw new Error('Invalid OMM ephemeris type');
  if (typeof row.OBJECT_NAME !== 'string' || !row.OBJECT_NAME.trim() || typeof row.OBJECT_ID !== 'string' ||
      typeof row.EPOCH !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?$/.test(row.EPOCH)) {
    throw new Error('Invalid OMM name or epoch');
  }
  row.EPOCH = row.EPOCH.replace(/Z$/, '') + 'Z';
  if (!Number.isFinite(Date.parse(row.EPOCH as string)) || !Number.isSafeInteger(row.NORAD_CAT_ID) || Number(row.NORAD_CAT_ID) <= 0 ||
      Number(row.MEAN_MOTION) <= 0 || Number(row.ECCENTRICITY) < 0 || Number(row.ECCENTRICITY) >= 1 ||
      Number(row.INCLINATION) < 0 || Number(row.INCLINATION) > 180) throw new Error('Invalid orbital elements');
  return row as Elements;
}

export function track(elements: Elements, at: Date, observer: Observer) {
  if (!Number.isFinite(at.getTime()) || ![observer.latitude, observer.longitude, observer.altitudeKm].every(Number.isFinite) ||
      Math.abs(observer.latitude) > 90 || Math.abs(observer.longitude) > 180 || observer.altitudeKm < -1) {
    throw new Error('Invalid time or observer coordinates');
  }
  const record = json2satrec(elements);
  const state = propagate(record, at);
  if (!state || !state.position || record.error) throw new Error(`Propagation failed (SGP4 ${record.error})`);
  const siderealTime = gstime(at);
  const geo = eciToGeodetic(state.position, siderealTime);
  const look = ecfToLookAngles({ latitude: observer.latitude * radians, longitude: observer.longitude * radians, height: observer.altitudeKm }, eciToEcf(state.position, siderealTime));
  const result = {
    latitude: degreesLat(geo.latitude), longitude: degreesLong(geo.longitude), altitudeKm: geo.height,
    azimuthDeg: look.azimuth / radians, elevationDeg: look.elevation / radians, rangeKm: look.rangeSat,
  };
  if (!Object.values(result).every(Number.isFinite)) throw new Error('Propagation produced invalid coordinates');
  return { ...result, temeKm: state.position };
}
