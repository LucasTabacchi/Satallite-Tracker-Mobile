import * as Location from 'expo-location';
import { Platform } from 'react-native';
import {
  readDeviceObserverFix, readLegacyAndroidAltitude, type DeviceLocationPort, type DeviceObserverFix, type HeadingGuidance, getHeadingGuidance,
  RECENT_LOCATION_MAX_ACCURACY_METERS, RECENT_LOCATION_MAX_AGE_MS,
} from '../device';

function observerCoordinates(coords: Location.LocationObjectCoords) {
  const { latitude, longitude, altitude, altitudeAccuracy } = coords;
  return { latitude, longitude, altitude: Platform.OS === 'android' ? readLegacyAndroidAltitude(altitude, altitudeAccuracy) : altitude };
}

const locationPort: DeviceLocationPort = {
  async requestForegroundPermissions() {
    const permission = await Location.getForegroundPermissionsAsync();
    return permission.granted || !permission.canAskAgain ? permission : Location.requestForegroundPermissionsAsync();
  },
  async getCurrentPosition() {
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced, mayShowUserSettingsDialog: false,
    });
    return observerCoordinates(position.coords);
  },
  async getRecentPosition() {
    const position = await Location.getLastKnownPositionAsync({
      maxAge: RECENT_LOCATION_MAX_AGE_MS, requiredAccuracy: RECENT_LOCATION_MAX_ACCURACY_METERS,
    });
    if (!position) return null;
    return { ...observerCoordinates(position.coords), accuracy: position.coords.accuracy, timestamp: position.timestamp };
  },
};

/** Call only from an explicit user action; no background location is requested. */
export function readDeviceObserver(onAcquiring?: () => void): Promise<DeviceObserverFix> {
  return readDeviceObserverFix(locationPort, onAcquiring);
}

/** Begins foreground heading updates; callers own and should remove the returned subscription. */
export function watchDeviceHeading(callback: (guidance: HeadingGuidance | null, error?: Error) => void, target: () => { azimuthDeg: number; elevationDeg: number }): Promise<Location.LocationSubscription> {
  return Location.watchHeadingAsync(heading => {
    try {
      callback(getHeadingGuidance(heading, target().azimuthDeg, target().elevationDeg));
    } catch (error) {
      callback(null, error instanceof Error ? error : new Error(String(error)));
    }
  });
}
