import { parseElements, type Elements } from '../src/orbit';
import { getJson, type Fetcher } from '../src/providers/http';
import { unsupported, type CatalogQuery, type DataProvider, type ValidationPosition, type ValidationQuery } from '../src/providers/types';

export type SpaceTrackCredentials = { identity: string; password: string };
export type N2yoCredentials = { apiKey: string };
type Tle = { line1: string; line2: string; name?: string; id?: number | string };
async function timedRequest(request: Fetcher, input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12_000);
  const abort = () => controller.abort(); init.signal?.addEventListener('abort', abort, { once: true });
  try { return await request(input, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timer); init.signal?.removeEventListener('abort', abort); }
}
function tleElements(tle: Tle, fallbackId: number): Elements {
  const id = Number(tle.id ?? tle.line1.slice(2, 7));
  if (id !== fallbackId || !tle.line1.startsWith('1 ') || !tle.line2.startsWith('2 ')) throw new Error('Invalid TLE response');
  const epoch = tle.line1.slice(18, 32), yy = Number(epoch.slice(0, 2)), year = yy >= 57 ? 1900 + yy : 2000 + yy;
  const exp = (s: string) => Number(`${s[0] === '-' ? '-' : ''}.${s.slice(1, 6)}e${s.slice(6)}`);
  return parseElements({ OBJECT_NAME: tle.name ?? `NORAD ${id}`, OBJECT_ID: '', CENTER_NAME: 'EARTH', REF_FRAME: 'TEME', TIME_SYSTEM: 'UTC', MEAN_ELEMENT_THEORY: 'SGP4',
    NORAD_CAT_ID: id, EPOCH: new Date(Date.UTC(year, 0, 1) + (Number(epoch.slice(2)) - 1) * 86400000).toISOString(), MEAN_MOTION: Number(tle.line2.slice(52, 63)),
    ECCENTRICITY: Number(`0.${tle.line2.slice(26, 33)}`), INCLINATION: Number(tle.line2.slice(8, 16)), RA_OF_ASC_NODE: Number(tle.line2.slice(17, 25)),
    ARG_OF_PERICENTER: Number(tle.line2.slice(34, 42)), MEAN_ANOMALY: Number(tle.line2.slice(43, 51)), BSTAR: exp(tle.line1.slice(53, 61)),
    MEAN_MOTION_DOT: Number(tle.line1.slice(33, 43)), MEAN_MOTION_DDOT: exp(tle.line1.slice(44, 52)), ELEMENT_SET_NO: Number(tle.line1.slice(64, 68)), EPHEMERIS_TYPE: 0 });
}
export class SpaceTrackProvider implements DataProvider {
  readonly id = 'spacetrack'; readonly capabilities = { catalog: true, orbital: true, validation: false } as const;
  private cookie?: string;
  private loginFlight?: Promise<void>;
  constructor(private readonly credentials: SpaceTrackCredentials, private readonly request: Fetcher = fetch) {
    if (!credentials.identity || !credentials.password) throw new Error('Space-Track credentials are required');
  }
  async getCatalog(query: CatalogQuery = {}): Promise<Elements[]> { return this.rows(query, 'catalog'); }
  async getOrbitalData(query: CatalogQuery = {}): Promise<Elements[]> { return this.rows(query, 'orbital'); }
  async getValidationPosition(_query: ValidationQuery): Promise<ValidationPosition> { return unsupported(this.id, 'validation'); }
  private async rows(query: CatalogQuery, operation: 'catalog' | 'orbital'): Promise<Elements[]> {
    // GP does not supply CelesTrak's curated membership; never broaden a group silently.
    if (query.noradId === undefined && query.group !== undefined && query.group !== 'active') {
      return unsupported(this.id, operation);
    }
    await this.login(query.signal);
    const filter = query.noradId ? `NORAD_CAT_ID/${query.noradId}` : 'DECAY_DATE/null-val';
    const url = `https://www.space-track.org/basicspacedata/query/class/gp/${filter}/orderby/NORAD_CAT_ID/format/json`;
    const response = await timedRequest(this.request, url, { signal: query.signal, headers: { Cookie: this.cookie ?? '', Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Space-Track request failed (${response.status})`);
    const rows = await response.json() as unknown;
    if (!Array.isArray(rows) || !rows.length) throw new Error('Space-Track returned an empty catalog');
    return rows.map(parseElements);
  }
  private async login(signal?: AbortSignal): Promise<void> {
    if (this.cookie) return;
    this.loginFlight ??= (async () => {
      const body = new URLSearchParams({ identity: this.credentials.identity, password: this.credentials.password });
      const response = await timedRequest(this.request, 'https://www.space-track.org/ajaxauth/login', { method: 'POST', signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
      if (!response.ok) throw new Error(`Space-Track authentication failed (${response.status})`);
      const cookies = response.headers.get('set-cookie');
      if (!cookies) throw new Error('Space-Track authentication returned no session');
      this.cookie = cookies.split(',').map(part => part.split(';')[0]).join('; ');
    })().finally(() => { this.loginFlight = undefined; });
    return this.loginFlight;
  }
}

type N2yoPositionResponse = { info?: { satid: number }; positions?: Array<{ satlatitude: number; satlongitude: number; sataltitude: number; timestamp: number }> };
export class N2yoProvider implements DataProvider {
  readonly id = 'n2yo'; readonly capabilities = { catalog: false, orbital: true, validation: true } as const;
  constructor(private readonly credentials: N2yoCredentials, private readonly request: Fetcher = fetch) {
    if (!credentials.apiKey) throw new Error('N2YO API key is required');
  }
  async getCatalog(_query?: CatalogQuery): Promise<Elements[]> { return unsupported(this.id, 'catalog'); }
  async getOrbitalData(query: CatalogQuery = {}): Promise<Elements[]> {
    query.signal?.throwIfAborted();
    const id = query.noradId; if (!Number.isSafeInteger(id) || !id || id <= 0) throw new Error('N2YO orbital request requires a valid NORAD ID');
    const data = await getJson<Tle & { info?: { satid: number }; tle?: string }>(this.request, `https://api.n2yo.com/rest/v1/satellite/tle/${id}&apiKey=${encodeURIComponent(this.credentials.apiKey)}`, query.signal);
    const lines = data.tle?.trim().split(/\r?\n/) ?? [];
    return [tleElements({ id: data.info?.satid ?? id, name: data.name, line1: data.line1 ?? lines.at(-2) ?? '', line2: data.line2 ?? lines.at(-1) ?? '' }, id)];
  }
  async getValidationPosition(query: ValidationQuery): Promise<ValidationPosition> {
    query.signal?.throwIfAborted();
    if (!Number.isSafeInteger(query.noradId) || query.noradId <= 0 || !Number.isFinite(query.at.getTime()) || query.at.getUTCMilliseconds() !== 0) throw new Error('N2YO validation requires a valid NORAD ID and whole-second timestamp');
    const { latitude, longitude, altitudeKm } = query.observer;
    if (![latitude, longitude, altitudeKm].every(Number.isFinite) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new Error('Invalid observer coordinates');
    // N2YO includes the current UTC second as sample zero, with at most 300 samples.
    const seconds = query.at.getTime() / 1000 - Math.floor(Date.now() / 1000) + 1;
    if (seconds < 1 || seconds > 300) throw new Error('N2YO timestamp is outside its current 300-position window');
    const url = `https://api.n2yo.com/rest/v1/satellite/positions/${query.noradId}/${latitude}/${longitude}/${altitudeKm * 1000}/${seconds}/?apiKey=${encodeURIComponent(this.credentials.apiKey)}`;
    const data = await getJson<N2yoPositionResponse>(this.request, url, query.signal), pos = data.positions?.find(p => p.timestamp === query.at.getTime() / 1000);
    if (data.info?.satid !== query.noradId || !pos) throw new Error('N2YO did not return the requested satellite timestamp');
    return { noradId: data.info.satid, timestamp: new Date(pos.timestamp * 1000), latitude: pos.satlatitude, longitude: pos.satlongitude, altitudeKm: pos.sataltitude };
  }
}
