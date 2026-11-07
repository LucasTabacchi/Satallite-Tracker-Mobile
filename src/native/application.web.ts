import AsyncStorage from '@react-native-async-storage/async-storage';
import { createDataService } from '../data-service';
import { CelesTrakProvider } from '../providers/celestrak';
import { ProxyProvider } from '../providers/proxy-client';
import { WhereTheIssProvider } from '../providers/wheretheiss';
import type { DataProvider } from '../providers/types';
import { CATALOG_GROUPS, createApplicationController, type ApplicationController } from '../application/controller';
import type { NativeApplicationOptions } from './application';

const unsupported = () => Promise.reject(new Error('Los recordatorios en segundo plano no están disponibles en la versión web.'));
export function createNativeApplication(options: NativeApplicationOptions = {}): ApplicationController {
  const providers: DataProvider[] = [new CelesTrakProvider(), new WhereTheIssProvider()];
  if (options.publicProxyUrl) providers.push(new ProxyProvider('spacetrack', options.publicProxyUrl), new ProxyProvider('n2yo', options.publicProxyUrl));
  const groupServices = new Map(CATALOG_GROUPS.map(group => [group, createDataService({ storage: AsyncStorage, providers })]));
  const validationServices = new Map([
    ['wheretheiss', createDataService({ storage: AsyncStorage, providers: providers.filter(provider => provider.id === 'wheretheiss') })],
    ['n2yo', createDataService({ storage: AsyncStorage, providers: providers.filter(provider => provider.id === 'n2yo') })],
  ] as const);
  const validationService = createDataService({ storage: AsyncStorage, providers });
  return createApplicationController({
    storage: AsyncStorage,
    data: {
      getCatalog: query => (groupServices.get(query?.group ?? 'stations') ?? groupServices.get('stations')!).getCatalog(query),
      getOrbitalData: query => (groupServices.get(query?.group ?? 'stations') ?? groupServices.get('stations')!).getOrbitalData(query),
      validate: (noradId, at, observer, elements, signal, provider) => (provider ? validationServices.get(provider) : validationService)!.validate(noradId, at, observer, elements, signal),
    },
    reminders: { enable: unsupported, disable: unsupported },
    now: options.now,
  });
}
export function readDeviceObserver(): Promise<never> {
  return Promise.reject(new Error('El GPS no está disponible en la versión web; introduce una ubicación manual.'));
}
export function watchDeviceHeading(): Promise<never> {
  return Promise.reject(new Error('La orientación del dispositivo no está disponible en la versión web.'));
}
export { createApplicationController } from '../application/controller';
export type { ApplicationController, ApplicationState, ApplicationControllerDependencies } from '../application/controller';
