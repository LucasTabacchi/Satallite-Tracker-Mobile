import AsyncStorage from '@react-native-async-storage/async-storage';
import { createDataService } from '../data-service';
import { CelesTrakProvider } from '../providers/celestrak';
import { ProxyProvider } from '../providers/proxy-client';
import { WhereTheIssProvider } from '../providers/wheretheiss';
import type { DataProvider } from '../providers/types';
import { CATALOG_GROUPS, createApplicationController, type ApplicationController, type ApplicationControllerDependencies } from '../application/controller';
import { enablePassReminders, disablePassReminders } from './background';
import { readDeviceObserver as readObserver, watchDeviceHeading } from './device';

export type NativeApplicationOptions = {
  /** Explicit HTTPS proxy URL; no N2YO or Space-Track credentials are accepted by the app. */
  publicProxyUrl?: string;
  now?: () => number;
};

export function createNativeApplication(options: NativeApplicationOptions = {}): ApplicationController {
  const providers: DataProvider[] = [new CelesTrakProvider(), new WhereTheIssProvider()];
  if (options.publicProxyUrl) {
    providers.push(new ProxyProvider('spacetrack', options.publicProxyUrl), new ProxyProvider('n2yo', options.publicProxyUrl));
  }
  const groupServices = new Map(CATALOG_GROUPS.map(group => [group, createDataService({ storage: AsyncStorage, providers })]));
  const validationServices = new Map([
    ['wheretheiss', createDataService({ storage: AsyncStorage, providers: providers.filter(provider => provider.id === 'wheretheiss') })],
    ['n2yo', createDataService({ storage: AsyncStorage, providers: providers.filter(provider => provider.id === 'n2yo') })],
  ] as const);
  const validationService = createDataService({ storage: AsyncStorage, providers });
  const data: ApplicationControllerDependencies['data'] = {
    getCatalog: query => (groupServices.get(query?.group ?? 'stations') ?? groupServices.get('stations')!).getCatalog(query),
    getOrbitalData: query => (groupServices.get(query?.group ?? 'stations') ?? groupServices.get('stations')!).getOrbitalData(query),
    validate: (noradId, at, observer, elements, signal, provider) => (provider ? validationServices.get(provider) : validationService)!.validate(noradId, at, observer, elements, signal),
  };
  const dependencies: ApplicationControllerDependencies = {
    storage: AsyncStorage,
    data,
    reminders: { enable: enablePassReminders, disable: disablePassReminders },
    now: options.now,
  };
  return createApplicationController(dependencies);
}

/** GPS permission is requested only when the user calls this adapter. */
export { readDeviceObserver } from './device';
/** Heading updates stay in the foreground and the returned subscription is caller-owned. */
export { watchDeviceHeading };
export { createApplicationController } from '../application/controller';
export type { ApplicationController, ApplicationState, ApplicationControllerDependencies } from '../application/controller';
