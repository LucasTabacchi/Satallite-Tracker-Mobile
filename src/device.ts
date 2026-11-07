import { parseObserver, type Observer } from './orbit';

type DevicePosition = { latitude: number; longitude: number; altitude: number | null };
type RecentDevicePosition = DevicePosition & { timestamp: number; accuracy: number | null };
export type DeviceLocationPort = {
  requestForegroundPermissions(): Promise<{ granted: boolean }>;
  getCurrentPosition(): Promise<DevicePosition>;
  getRecentPosition?(): Promise<RecentDevicePosition | null>;
};

const DEVICE_PERMISSION_TIMEOUT_MS = 20_000;
const DEVICE_POSITION_TIMEOUT_MS = 15_000;
const RECENT_LOOKUP_TIMEOUT_MS = 2_000;
export const RECENT_LOCATION_MAX_AGE_MS = 60_000;
export const RECENT_LOCATION_MAX_ACCURACY_METERS = 200;
export type DeviceObserverFix = { observer: Observer; source: 'current' | 'recent' };
type LocationPhase = 'permission' | 'position' | 'recent';

/** The legacy Android bridge emits zero for an absent altitude and accuracy. */
export function readLegacyAndroidAltitude(altitude: number | null, verticalAccuracy: number | null): number | null {
  if (altitude === 0 && (verticalAccuracy === null || !Number.isFinite(verticalAccuracy) || verticalAccuracy <= 0)) return null;
  return altitude;
}

export class DeviceLocationTimeoutError extends Error {
  constructor(readonly phase: LocationPhase) {
    super(`Timed out waiting for device location (${phase})`);
    this.name = 'DeviceLocationTimeoutError';
  }
}

async function withLocationDeadline<T>(request: () => Promise<T>, milliseconds: number, phase: LocationPhase): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new DeviceLocationTimeoutError(phase)), milliseconds);
  });
  try {
    return await Promise.race([request(), deadline]);
  } finally {
    clearTimeout(timeout);
  }
}

function toObserver(fix: DevicePosition): Observer {
  if (fix.altitude === null || !Number.isFinite(fix.altitude)) {
    throw new Error('GPS altitude is unavailable; use manual location or provide an explicit altitude');
  }
  return parseObserver(String(fix.latitude), String(fix.longitude), String(fix.altitude));
}

/** Prefer a current foreground fix and distinguish any recent cached fallback. */
export async function readDeviceObserverFix(port: DeviceLocationPort, onAcquiring?: () => void): Promise<DeviceObserverFix> {
  const permission = await withLocationDeadline(() => port.requestForegroundPermissions(), DEVICE_PERMISSION_TIMEOUT_MS, 'permission');
  if (!permission.granted) throw new Error('Foreground location permission denied; use manual location instead');
  onAcquiring?.();
  try {
    const current = await withLocationDeadline(() => port.getCurrentPosition(), DEVICE_POSITION_TIMEOUT_MS, 'position');
    return { observer: toObserver(current), source: 'current' };
  } catch (error) {
    const getRecent = port.getRecentPosition?.bind(port);
    if (getRecent) {
      const observer = await withLocationDeadline(getRecent, RECENT_LOOKUP_TIMEOUT_MS, 'recent').then(fix => {
        if (!fix || fix.accuracy === null || !Number.isFinite(fix.accuracy) || fix.accuracy < 0 ||
            fix.accuracy > RECENT_LOCATION_MAX_ACCURACY_METERS) return undefined;
        const age = Date.now() - fix.timestamp;
        if (!Number.isFinite(age) || age < 0 || age > RECENT_LOCATION_MAX_AGE_MS) return undefined;
        return toObserver(fix);
      }).catch(() => undefined);
      if (observer) return { observer, source: 'recent' };
    }
    throw error;
  }
}

export async function readDeviceObserver(port: DeviceLocationPort): Promise<Observer> {
  return (await readDeviceObserverFix(port)).observer;
}

export type HeadingGuidance = { turnDegrees: number; targetElevationDeg: number };

/** Returns a signed shortest turn from true north-referenced heading to the target azimuth. */
export function getHeadingGuidance(
  heading: { trueHeading: number; accuracy: number },
  targetAzimuthDeg: number,
  targetElevationDeg: number,
): HeadingGuidance {
  if (!Number.isFinite(heading.trueHeading) || heading.trueHeading < 0 || heading.trueHeading >= 360) {
    throw new Error('True heading is unavailable');
  }
  if (!Number.isFinite(heading.accuracy) || heading.accuracy <= 0) {
    throw new Error('Heading accuracy is unreliable');
  }
  if (!Number.isFinite(targetAzimuthDeg) || targetAzimuthDeg < 0 || targetAzimuthDeg >= 360 ||
      !Number.isFinite(targetElevationDeg) || targetElevationDeg < -90 || targetElevationDeg > 90) {
    throw new Error('Invalid target azimuth or elevation');
  }
  const turnDegrees = ((targetAzimuthDeg - heading.trueHeading + 540) % 360) - 180;
  return { turnDegrees, targetElevationDeg };
}
