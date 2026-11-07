import { track, type Elements, type Observer } from './orbit';

export type SkySample = {
  at: Date;
  azimuthDeg: number;
  elevationDeg: number;
};

export type PassWindow = {
  /** Null means the scan began while already above the threshold. */
  aos: SkySample | null;
  /** Null means the scan horizon ended while still above the threshold. */
  los: SkySample | null;
  maximum: SkySample;
  samples: SkySample[];
  startsVisible: boolean;
  endsVisible: boolean;
  continuous: boolean;
};

export type PassPredictionOptions = {
  start: Date;
  horizonHours: number;
  minimumElevationDeg?: number;
  coarseStepSeconds?: number;
  refinementToleranceSeconds?: number;
  maxPasses?: number;
  maxSamples?: number;
  yieldEverySamples?: number;
  signal?: AbortSignal;
};

export type PassPredictionResult = {
  visibilityKind: 'radio-geometric';
  start: Date;
  end: Date;
  windows: PassWindow[];
  sampleCount: number;
};

const yieldToEventLoop = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/**
 * Finds geometric/radio horizon windows with a bounded coarse scan and binary
 * refinement. It does not account for sunlight, clouds, terrain, or optical visibility.
 */
export async function predictPasses(
  elements: Elements,
  observer: Observer,
  options: PassPredictionOptions,
): Promise<PassPredictionResult> {
  const startMs = options.start?.getTime();
  const horizonHours = options.horizonHours;
  const minimumElevationDeg = options.minimumElevationDeg ?? 0;
  const stepSeconds = options.coarseStepSeconds ?? 30;
  const toleranceSeconds = options.refinementToleranceSeconds ?? 1;
  const maxPasses = options.maxPasses ?? 50;
  const maxSamples = options.maxSamples ?? 10_000;
  const yieldEvery = options.yieldEverySamples ?? 128;
  if (!Number.isFinite(startMs)) throw new Error('Invalid prediction start time');
  if (!Number.isFinite(horizonHours) || horizonHours <= 0 || horizonHours > 24 * 30) throw new Error('Invalid prediction horizon');
  if (!Number.isFinite(minimumElevationDeg) || minimumElevationDeg < -5 || minimumElevationDeg >= 90) throw new Error('Invalid minimum elevation threshold');
  if (!Number.isFinite(stepSeconds) || stepSeconds < 1 || stepSeconds > 3600) throw new Error('Invalid coarse sample step');
  if (!Number.isFinite(toleranceSeconds) || toleranceSeconds <= 0 || toleranceSeconds > stepSeconds) throw new Error('Invalid refinement tolerance');
  if (!Number.isSafeInteger(maxPasses) || maxPasses < 1 || maxPasses > 1000) throw new Error('Invalid pass limit');
  if (!Number.isSafeInteger(maxSamples) || maxSamples < 2 || maxSamples > 1_000_000) throw new Error('Invalid sample limit');
  if (!Number.isSafeInteger(yieldEvery) || yieldEvery < 1) throw new Error('Invalid cooperative yield interval');

  const endMs = startMs + horizonHours * 3_600_000;
  // The midpoint probe catches narrower/grazing windows whose peak lies between coarse endpoints.
  const scanStepSeconds = stepSeconds / 2;
  const estimatedSamples = Math.ceil((endMs - startMs) / (scanStepSeconds * 1000)) + 1;
  if (estimatedSamples > maxSamples) throw new Error(`Prediction exceeds sample limit (${maxSamples})`);
  let sampleCount = 0;
  const checkCancelled = () => {
    if (options.signal?.aborted) throw new Error('Prediction cancelled');
  };
  const sampleAt = async (timeMs: number): Promise<SkySample> => {
    checkCancelled();
    if (sampleCount >= maxSamples) throw new Error(`Prediction exceeds sample limit (${maxSamples})`);
    const position = track(elements, new Date(timeMs), observer);
    sampleCount++;
    if (sampleCount % yieldEvery === 0) {
      await yieldToEventLoop();
      checkCancelled();
    }
    return { at: new Date(timeMs), azimuthDeg: position.azimuthDeg, elevationDeg: position.elevationDeg };
  };

  const grid: SkySample[] = [];
  for (let timeMs = startMs; timeMs < endMs; timeMs += scanStepSeconds * 1000) grid.push(await sampleAt(timeMs));
  if (grid.at(-1)?.at.getTime() !== endMs) grid.push(await sampleAt(endMs));
  const visible = (sample: SkySample) => sample.elevationDeg >= minimumElevationDeg;

  const refineCrossing = async (left: SkySample, right: SkySample): Promise<SkySample> => {
    let low = left;
    let high = right;
    const lowVisible = visible(low);
    while ((high.at.getTime() - low.at.getTime()) / 1000 > toleranceSeconds) {
      const middle = await sampleAt((low.at.getTime() + high.at.getTime()) / 2);
      if (visible(middle) === lowVisible) low = middle;
      else high = middle;
    }
    const crossing = await sampleAt((low.at.getTime() + high.at.getTime()) / 2);
    return { ...crossing, elevationDeg: minimumElevationDeg };
  };

  const windows: PassWindow[] = [];
  let current: PassWindow | null = null;
  if (visible(grid[0]!)) {
    current = { aos: null, los: null, maximum: grid[0]!, samples: [grid[0]!], startsVisible: true, endsVisible: false, continuous: false };
  }
  for (let index = 1; index < grid.length; index++) {
    const previous = grid[index - 1]!;
    const currentSample = grid[index]!;
    const wasVisible = visible(previous);
    const isVisible = visible(currentSample);
    if (wasVisible !== isVisible) {
      const crossing = await refineCrossing(previous, currentSample);
      if (isVisible) {
        current = { aos: crossing, los: null, maximum: crossing, samples: [crossing, currentSample], startsVisible: false, endsVisible: false, continuous: false };
      } else if (current) {
        current.samples.push(crossing);
        current.los = crossing;
        current.maximum = current.samples.reduce((best, sample) => sample.elevationDeg > best.elevationDeg ? sample : best);
        windows.push(current);
        current = null;
      }
    } else if (isVisible && current) {
      current.samples.push(currentSample);
    }
    if (isVisible && current && currentSample.elevationDeg > current.maximum.elevationDeg) current.maximum = currentSample;
  }
  if (current) {
    current.endsVisible = true;
    current.samples.push(grid.at(-1)!);
    current.maximum = current.samples.reduce((best, sample) => sample.elevationDeg > best.elevationDeg ? sample : best);
    current.continuous = current.startsVisible;
    windows.push(current);
  }
  checkCancelled();
  const returnedWindows = windows.slice(0, maxPasses);
  const goldenRatio = (Math.sqrt(5) - 1) / 2;
  for (const window of returnedWindows) {
    const peakIndex = window.samples.reduce((best, sample, index, all) => sample.elevationDeg > all[best]!.elevationDeg ? index : best, 0);
    const leftMs = window.samples[Math.max(0, peakIndex - 1)]!.at.getTime();
    const rightMs = window.samples[Math.min(window.samples.length - 1, peakIndex + 1)]!.at.getTime();
    let low = Math.min(leftMs, rightMs);
    let high = Math.max(leftMs, rightMs);
    if (high > low) {
      let c = high - goldenRatio * (high - low);
      let d = low + goldenRatio * (high - low);
      let fc = await sampleAt(c);
      let fd = await sampleAt(d);
      while (high - low > toleranceSeconds * 1000) {
        if (fc.elevationDeg < fd.elevationDeg) {
          low = c;
          c = d;
          fc = fd;
          d = low + goldenRatio * (high - low);
          fd = await sampleAt(d);
        } else {
          high = d;
          d = c;
          fd = fc;
          c = high - goldenRatio * (high - low);
          fc = await sampleAt(c);
        }
      }
      window.maximum = fc.elevationDeg >= fd.elevationDeg ? fc : fd;
    }
  }
  checkCancelled();
  return { visibilityKind: 'radio-geometric', start: new Date(startMs), end: new Date(endMs), windows: returnedWindows, sampleCount };
}
