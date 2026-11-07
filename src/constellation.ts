import { track, type Elements, type Observer } from './orbit';

export type ConstellationPosition = { index: number; noradId: number; latitude: number; longitude: number; altitudeKm: number; azimuthDeg: number; elevationDeg: number };
export type ConstellationFailure = { index: number; noradId: number | null; reason: string };
export type ConstellationResult = { positions: ConstellationPosition[]; failures: ConstellationFailure[]; processed: number };
export type ConstellationOptions = { maxObjects?: number; batchSize?: number; signal?: AbortSignal };

const yieldToEventLoop = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** Propagates a bounded array in deterministic input order, isolating bad records. */
export async function propagateConstellation(
  elements: readonly Elements[],
  observer: Observer,
  at: Date,
  options: ConstellationOptions = {},
): Promise<ConstellationResult> {
  const maxObjects = options.maxObjects ?? 200;
  const batchSize = options.batchSize ?? 20;
  if (!Number.isSafeInteger(maxObjects) || maxObjects < 1 || maxObjects > 10_000) throw new Error('Invalid constellation object limit');
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1000) throw new Error('Invalid constellation batch size');
  if (elements.length > maxObjects) throw new Error(`Constellation exceeds object limit (${maxObjects})`);
  if (!Number.isFinite(at?.getTime())) throw new Error('Invalid constellation time');
  const positions: ConstellationPosition[] = [];
  const failures: ConstellationFailure[] = [];
  for (let index = 0; index < elements.length; index++) {
    if (options.signal?.aborted) throw new Error('Constellation propagation cancelled');
    const item = elements[index]!;
    try {
      const position = track(item, at, observer);
      positions.push({ index, noradId: item.NORAD_CAT_ID, latitude: position.latitude, longitude: position.longitude, altitudeKm: position.altitudeKm, azimuthDeg: position.azimuthDeg, elevationDeg: position.elevationDeg });
    } catch (error) {
      failures.push({ index, noradId: Number.isSafeInteger(item?.NORAD_CAT_ID) ? item.NORAD_CAT_ID : null, reason: error instanceof Error ? error.message : String(error) });
    }
    if ((index + 1) % batchSize === 0 && index + 1 < elements.length) {
      await yieldToEventLoop();
      if (options.signal?.aborted) throw new Error('Constellation propagation cancelled');
    }
  }
  return { positions, failures, processed: elements.length };
}
