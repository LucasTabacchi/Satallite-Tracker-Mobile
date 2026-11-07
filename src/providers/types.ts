import type { Elements, Observer } from '../orbit';

export type ConstellationGroup = 'stations' | 'starlink' | 'gps-ops' | 'weather' | 'noaa' | 'goes' | 'active' | 'science' | 'amateur' | 'cubesat';
export type ProviderCapabilities = { catalog: boolean; orbital: boolean; validation: boolean };
export type CatalogQuery = { group?: ConstellationGroup; query?: string; noradId?: number; signal?: AbortSignal };
export type ValidationQuery = { noradId: number; at: Date; observer: Observer; signal?: AbortSignal };
export type ValidationPosition = { noradId: number; timestamp: Date; latitude: number; longitude: number; altitudeKm: number };
export type DataProvider = {
  id: string;
  capabilities: ProviderCapabilities;
  getCatalog(query?: CatalogQuery): Promise<Elements[]>;
  getOrbitalData(query?: CatalogQuery): Promise<Elements[]>;
  getValidationPosition(query: ValidationQuery): Promise<ValidationPosition>;
};
export class UnsupportedOperationError extends Error {
  constructor(provider: string, operation: keyof ProviderCapabilities) { super(`Provider ${provider} does not support ${operation}`); this.name = 'UnsupportedOperationError'; }
}
export function unsupported(provider: string, operation: keyof ProviderCapabilities): never { throw new UnsupportedOperationError(provider, operation); }
export function isElements(value: unknown): value is Elements { return !!value && typeof value === 'object'; }
