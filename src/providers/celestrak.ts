import { parseElements, type Elements } from '../orbit';
import { getCsv, getJson, type Fetcher } from './http';
import { parseCelesTrakCsv } from './celestrak-csv';
import { unsupported, type CatalogQuery, type DataProvider, type ValidationQuery, type ValidationPosition, type ConstellationGroup } from './types';

const groups: ConstellationGroup[] = ['stations', 'starlink', 'gps-ops', 'weather', 'noaa', 'goes', 'active', 'science', 'amateur', 'cubesat'];
export const CELESTRAK_GROUPS = Object.freeze(groups);
export function celestrakGroup(value?: string): ConstellationGroup {
  if (!value || !groups.includes(value.toLowerCase() as ConstellationGroup)) throw new Error('Unsupported CelesTrak group');
  return value.toLowerCase() as ConstellationGroup;
}
function parseRows(payload: unknown): Elements[] {
  if (!Array.isArray(payload) || payload.length === 0) throw new Error('Provider returned an empty or invalid catalog');
  return payload.map(parseElements);
}
export class CelesTrakProvider implements DataProvider {
  readonly id = 'celestrak';
  readonly capabilities = { catalog: true, orbital: true, validation: false } as const;
  constructor(private readonly request: Fetcher = fetch) {}
  async getCatalog(query: CatalogQuery = {}): Promise<Elements[]> { return this.fetchElements(query); }
  async getOrbitalData(query: CatalogQuery = {}): Promise<Elements[]> { return this.fetchElements(query); }
  async getValidationPosition(_query: ValidationQuery): Promise<ValidationPosition> { return unsupported(this.id, 'validation'); }
  private async fetchElements(query: CatalogQuery): Promise<Elements[]> {
    const params = new URLSearchParams({ FORMAT: 'JSON' });
    let url: string;
    if (query.noradId !== undefined) {
      if (!Number.isSafeInteger(query.noradId) || query.noradId <= 0 || query.noradId > 999_999_999) throw new Error('Invalid NORAD ID');
      params.set('CATNR', String(query.noradId)); url = 'https://celestrak.org/NORAD/elements/gp.php';
    } else if (query.query?.trim()) {
      params.set('NAME', query.query.trim().slice(0, 80)); url = 'https://celestrak.org/NORAD/elements/gp.php';
    } else {
      const group = celestrakGroup(query.group ?? 'stations');
      if (group === 'starlink') {
        const csv = await getCsv(this.request, 'https://celestrak.org/NORAD/elements/supplemental/sup-gp.php?FILE=starlink&FORMAT=CSV', query.signal);
        query.signal?.throwIfAborted();
        return parseCelesTrakCsv(csv);
      }
      params.set('GROUP', group.toUpperCase());
      url = 'https://celestrak.org/NORAD/elements/gp.php';
    }
    return parseRows(await getJson(this.request, `${url}?${params}`, query.signal));
  }
}
