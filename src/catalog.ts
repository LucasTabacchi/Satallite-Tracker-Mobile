import { parseElements, type Elements } from './orbit';

export const TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_KEY = 'satellite-tracker:stations:v1';
export interface CatalogProvider { getCatalog(): Promise<Elements[]> }
export interface Storage { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> }
export type Catalog = { elements: Elements[]; fetchedAt: number; source: 'network' | 'cache' | 'stale-cache'; warning?: string };

function parseCatalog(value: unknown): Elements[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('Invalid or empty satellite catalog');
  return value.map(parseElements);
}

export class CelesTrakProvider implements CatalogProvider {
  constructor(private readonly request: typeof fetch = fetch) {}
  async getCatalog(): Promise<Elements[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await this.request('https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=json', { signal: controller.signal });
      if (!response.ok) throw new Error(`CelesTrak HTTP ${response.status}`);
      return parseCatalog(await response.json());
    } finally { clearTimeout(timeout); }
  }
}

export class CatalogRepository {
  constructor(private readonly provider: CatalogProvider, private readonly storage: Storage) {}
  async load(now = Date.now()): Promise<Catalog> {
    let cached: Catalog | undefined;
    try {
      const raw = await this.storage.getItem(CACHE_KEY);
      if (raw) {
        const value = JSON.parse(raw);
        if (typeof value.fetchedAt === 'number' && Number.isFinite(value.fetchedAt) && value.fetchedAt <= now) {
          cached = { elements: parseCatalog(value.elements), fetchedAt: value.fetchedAt, source: 'cache' };
        }
      }
    } catch { /* Corrupt or unavailable storage must not prevent a fresh download. */ }
    if (cached && now - cached.fetchedAt < TTL_MS) return cached;
    try {
      const result: Catalog = { elements: await this.provider.getCatalog(), fetchedAt: now, source: 'network' };
      try { await this.storage.setItem(CACHE_KEY, JSON.stringify(result)); }
      catch { result.warning = 'Fresh data loaded, but the offline cache could not be saved.'; }
      return result;
    } catch (error) {
      if (!cached) throw error;
      return { ...cached, source: 'stale-cache', warning: 'Refresh failed. Using expired offline data; accuracy may be degraded.' };
    }
  }
}

export function filterCatalog(rows: Elements[], query: string): Elements[] {
  const term = query.trim().toLowerCase();
  return rows.filter(row => row.OBJECT_NAME.toLowerCase().includes(term) || String(row.NORAD_CAT_ID).includes(term));
}
