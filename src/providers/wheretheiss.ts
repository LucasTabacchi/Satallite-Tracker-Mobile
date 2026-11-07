import { parseElements, type Elements } from '../orbit';
import { getJson, type Fetcher } from './http';
import { unsupported, type DataProvider, type ValidationQuery, type ValidationPosition, type CatalogQuery } from './types';

const ISS_NORAD = 25544;
export function supportsIssOrbitalQuery(query: CatalogQuery): boolean {
  return query.noradId === undefined ? (query.group ?? 'stations') === 'stations' : query.noradId === ISS_NORAD;
}
type IssPosition = { id: number; latitude: number; longitude: number; altitude: number; timestamp: number };
type IssTle = { id: string; name: string; line1: string; line2: string; tle_timestamp: number };
function tleToElements(tle: IssTle): Elements {
  if (Number(tle.id) !== ISS_NORAD || !tle.line1.startsWith('1 ') || !tle.line2.startsWith('2 ')) throw new Error('Invalid ISS TLE response');
  const line1 = tle.line1, line2 = tle.line2;
  const epoch = line1.slice(18, 32);
  const year = Number(epoch.slice(0, 2));
  const fullYear = year >= 57 ? 1900 + year : 2000 + year;
  const epochDate = new Date(Date.UTC(fullYear, 0, 1) + (Number(epoch.slice(2)) - 1) * 86400000);
  const revPerDay = Number(line2.slice(52, 63));
  const ndot = Number(line1.slice(33, 43));
  const nddotText = line1.slice(44, 52);
  const bstarText = line1.slice(53, 61);
  const implied = (value: string) => Number(`${value[0] === '-' ? '-' : ''}.${value.slice(1, 6)}e${value.slice(6)}`);
  const elements = {
    OBJECT_NAME: tle.name.toUpperCase(), OBJECT_ID: '', CENTER_NAME: 'EARTH', REF_FRAME: 'TEME', TIME_SYSTEM: 'UTC', MEAN_ELEMENT_THEORY: 'SGP4',
    NORAD_CAT_ID: ISS_NORAD, EPOCH: epochDate.toISOString(), MEAN_MOTION: revPerDay, ECCENTRICITY: Number(`0.${line2.slice(26, 33)}`),
    INCLINATION: Number(line2.slice(8, 16)), RA_OF_ASC_NODE: Number(line2.slice(17, 25)), ARG_OF_PERICENTER: Number(line2.slice(34, 42)),
    MEAN_ANOMALY: Number(line2.slice(43, 51)), BSTAR: implied(bstarText), MEAN_MOTION_DOT: ndot, MEAN_MOTION_DDOT: implied(nddotText),
    ELEMENT_SET_NO: Number(line1.slice(64, 68)), EPHEMERIS_TYPE: 0,
  };
  return parseElements(elements);
}
export class WhereTheIssProvider implements DataProvider {
  readonly id = 'wheretheiss';
  readonly capabilities = { catalog: false, orbital: true, validation: true } as const;
  constructor(private readonly request: Fetcher = fetch) {}
  async getCatalog(_query?: CatalogQuery): Promise<Elements[]> { return unsupported(this.id, 'catalog'); }
  async getOrbitalData(query: CatalogQuery = {}): Promise<Elements[]> {
    if (!supportsIssOrbitalQuery(query)) return unsupported(this.id, 'orbital');
    const tle = await getJson<IssTle>(this.request, `https://api.wheretheiss.at/v1/satellites/${ISS_NORAD}/tles`, query.signal);
    return [tleToElements(tle)];
  }
  async getValidationPosition(query: ValidationQuery): Promise<ValidationPosition> {
    if (query.noradId !== ISS_NORAD) return unsupported(this.id, 'validation');
    const at = Math.floor(query.at.getTime() / 1000);
    if (!Number.isFinite(at)) throw new Error('Invalid validation timestamp');
    const pos = await getJson<IssPosition>(this.request, `https://api.wheretheiss.at/v1/satellites/${ISS_NORAD}?units=kilometers&timestamp=${at}`, query.signal);
    if (pos.id !== ISS_NORAD || pos.timestamp !== at) throw new Error('ISS provider returned mismatched NORAD ID or timestamp');
    return { noradId: pos.id, timestamp: new Date(pos.timestamp * 1000), latitude: pos.latitude, longitude: pos.longitude, altitudeKm: pos.altitude };
  }
}
