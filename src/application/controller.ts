import { propagateConstellation } from '../constellation';
import { filterCatalog, TTL_MS } from '../catalog';
import { generateGroundTrack, type GroundTrack } from '../geometry';
import { track, type Elements, type Observer } from '../orbit';
import { predictPasses, type PassPredictionResult } from '../prediction';
import type { ConstellationGroup, DataProvider } from '../providers/types';
import { StarlinkDownloadPausedError, type DataResult } from '../data-service';
import type { RefreshSettings } from '../refresh';
import type { ValidationRow } from '../validation';

export const APPLICATION_PREFERENCES_KEY = 'satellite-tracker:application:v1';
export const CATALOG_GROUPS: readonly ConstellationGroup[] = ['stations', 'starlink', 'gps-ops', 'weather', 'noaa', 'goes', 'active', 'science', 'amateur', 'cubesat'];
export type ValidationStatus = 'idle' | 'loading' | 'success' | 'error';
export type ValidationProvider = 'wheretheiss' | 'n2yo';
export type ApplicationPosition = Pick<ReturnType<typeof track>, 'latitude' | 'longitude' | 'altitudeKm' | 'temeKm'> & Partial<Pick<ReturnType<typeof track>, 'azimuthDeg' | 'elevationDeg' | 'rangeKm'>>;
export type ApplicationState = {
  initialized: boolean; active: boolean; group: ConstellationGroup; query: string;
  catalog: Elements[]; catalogFetchedAt?: number; catalogEpoch?: string; catalogAgeMs?: number;
  catalogSource?: DataResult['source']; catalogProvider?: string; catalogWarning?: string; catalogStale: boolean;
  selectedNoradId?: number; position?: ApplicationPosition; groundTrack?: GroundTrack;
  constellation?: Awaited<ReturnType<typeof propagateConstellation>>; constellationEnabled: boolean; constellationLimit: number;
  observer?: Observer; minimumElevationDeg: number; leadMinutes: number;
  passes?: PassPredictionResult; validationStatus: ValidationStatus; validationRows: ValidationRow[];
  validationError?: string; validationObserverSource?: 'device' | 'manual' | 'calculation-origin';
  remindersEnabled: boolean; reminderError?: string; error?: string;
};
export type ApplicationData = {
  getCatalog(query?: Parameters<DataProvider['getCatalog']>[0]): Promise<DataResult>;
  getOrbitalData(query?: Parameters<DataProvider['getOrbitalData']>[0]): Promise<DataResult>;
  validate(noradId: number, at: Date, observer: Observer, elements?: Elements[], signal?: AbortSignal, provider?: ValidationProvider): Promise<ValidationRow[]>;
};
export type ApplicationStorage = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };
export type ApplicationApplicationReminders = { enable(settings: RefreshSettings): Promise<unknown>; disable(): Promise<unknown> };
export type ApplicationControllerDependencies = {
  storage: ApplicationStorage; data: ApplicationData; reminders: ApplicationApplicationReminders;
  now?: () => number; setInterval?: typeof globalThis.setInterval; clearInterval?: typeof globalThis.clearInterval;
  predict?: typeof predictPasses;
  onError?: (error: Error) => void;
};
export type ApplicationController = {
  getState(): ApplicationState; subscribe(listener: () => void): () => void;
  initialize(): Promise<void>; setActive(active: boolean): void; setQuery(query: string): void;
  selectGroup(group: ConstellationGroup): Promise<void>; refreshCatalog(): Promise<void>;
  selectSatellite(noradId: number | null): Promise<void>; refreshGroundTrack(): void;
  propagateConstellation(limit?: number): Promise<void>; setObserver(observer: Observer, source?: 'device' | 'manual'): void;
  setConstellationEnabled(enabled: boolean, limit?: number): void;
  clearObserver(): void; setMinimumElevation(degrees: number): void; setLeadMinutes(minutes: number): void;
  refreshPasses(): Promise<void>; validateSelected(provider?: ValidationProvider): Promise<void>; enableReminders(): Promise<void>;
  disableReminders(): Promise<void>; dispose(): void;
};

const initialState = (): ApplicationState => ({ initialized: false, active: false, group: 'stations', query: '', catalog: [], catalogStale: false, minimumElevationDeg: 0, leadMinutes: 10, validationStatus: 'idle', validationRows: [], remindersEnabled: false, constellationEnabled: false, constellationLimit: 50 });
function errorText(error: unknown): string {
  if (error instanceof StarlinkDownloadPausedError) {
    return `CelesTrak rechazó la descarga de Starlink (HTTP 403). No se volverá a consultar antes de ${new Date(error.retryAt).toLocaleString('es-AR')}.`;
  }
  return error instanceof Error ? error.message : String(error);
}
function validObserver(value: unknown): value is Observer {
  if (!value || typeof value !== 'object') return false;
  const item = value as Observer;
  return [item.latitude, item.longitude, item.altitudeKm].every(Number.isFinite) && Math.abs(item.latitude) <= 90 && Math.abs(item.longitude) <= 180 && item.altitudeKm >= -1;
}
function readPreferences(raw: string | null): Pick<ApplicationState, 'group' | 'selectedNoradId' | 'observer' | 'minimumElevationDeg' | 'leadMinutes'> {
  const defaults = { group: 'stations' as ConstellationGroup, minimumElevationDeg: 0, leadMinutes: 10 };
  if (!raw) return defaults;
  try {
    const value = JSON.parse(raw);
    if (!value || value.version !== 1) return defaults;
    return {
      group: CATALOG_GROUPS.includes(value.group) ? value.group : defaults.group,
      selectedNoradId: Number.isSafeInteger(value.selectedNoradId) && value.selectedNoradId > 0 ? value.selectedNoradId : undefined,
      observer: validObserver(value.observer) ? { ...value.observer } : undefined,
      minimumElevationDeg: Number.isFinite(value.minimumElevationDeg) && value.minimumElevationDeg >= 0 && value.minimumElevationDeg < 90 ? value.minimumElevationDeg : defaults.minimumElevationDeg,
      leadMinutes: Number.isInteger(value.leadMinutes) && value.leadMinutes >= 1 && value.leadMinutes <= 180 ? value.leadMinutes : defaults.leadMinutes,
    };
  } catch { return defaults; }
}

/** Framework-neutral observable application state; all orbital work remains local between bounded fetches. */
export function createApplicationController(deps: ApplicationControllerDependencies): ApplicationController {
  let state = initialState();
  const listeners = new Set<() => void>();
  const setEvery = deps.setInterval ?? globalThis.setInterval, clearEvery = deps.clearInterval ?? globalThis.clearInterval;
  let disposed = false, catalogRevision = 0, selectionRevision = 0, predictionRevision = 0, validationRevision = 0, constellationRevision = 0, preferenceRevision = 0;
  let catalogAbort: AbortController | undefined, selectionAbort: AbortController | undefined, predictionAbort: AbortController | undefined, validationAbort: AbortController | undefined;
  let propagationTimer: ReturnType<typeof setInterval> | undefined, groundTrackTimer: ReturnType<typeof setInterval> | undefined, constellationTimer: ReturnType<typeof setInterval> | undefined, ttlRefreshTimer: ReturnType<typeof setInterval> | undefined, constellationRunning = false;
  let selectedElements: Elements | undefined, preferenceQueue = Promise.resolve(), reminderRevision = 0;
  const publish = () => { if (disposed) return; state = { ...state }; for (const listener of [...listeners]) listener(); };
  const persist = () => {
    const snapshot = { version: 1, group: state.group, selectedNoradId: state.selectedNoradId ?? null, observer: state.observer ?? null, minimumElevationDeg: state.minimumElevationDeg, leadMinutes: state.leadMinutes };
    preferenceQueue = preferenceQueue.catch(() => {}).then(() => deps.storage.setItem(APPLICATION_PREFERENCES_KEY, JSON.stringify(snapshot))).catch(error => { state.error = `No se pudieron guardar las preferencias: ${errorText(error)}`; publish(); });
  };
  const stopTelemetryTimers = () => { if (propagationTimer !== undefined) clearEvery(propagationTimer); if (groundTrackTimer !== undefined) clearEvery(groundTrackTimer); if (constellationTimer !== undefined) clearEvery(constellationTimer); propagationTimer = groundTrackTimer = constellationTimer = undefined; constellationRevision++; };
  const stopAllTimers = () => { stopTelemetryTimers(); if (ttlRefreshTimer !== undefined) clearEvery(ttlRefreshTimer); ttlRefreshTimer = undefined; };
  const clearSelection = () => { selectedElements = undefined; state.selectedNoradId = undefined; state.position = undefined; state.groundTrack = undefined; state.passes = undefined; state.constellation = undefined; };
  const propagate = () => {
    if (!state.active || !selectedElements) return;
    try {
      const stamp = (deps.now ?? Date.now)();
      const propagated = track(selectedElements, new Date(stamp), state.observer ?? { latitude: 0, longitude: 0, altitudeKm: 0 });
      state.position = state.observer ? propagated : { latitude: propagated.latitude, longitude: propagated.longitude, altitudeKm: propagated.altitudeKm, temeKm: propagated.temeKm };
      if (state.catalogFetchedAt !== undefined) { state.catalogAgeMs = Math.max(0, stamp - state.catalogFetchedAt); state.catalogStale = state.catalogAgeMs >= TTL_MS || state.catalogSource === 'stale-cache'; }
      publish();
    }
    catch (error) { state.error = errorText(error); publish(); }
  };
  const startPositionTimer = () => { if (propagationTimer === undefined && state.active && selectedElements) { propagate(); propagationTimer = setEvery(propagate, 2000); } };
  const runConstellation = async (limit = state.constellationLimit) => {
    if (disposed || constellationRunning || !state.catalog.length) return;
    constellationRunning = true;
    const revision = ++constellationRevision; const input = state.catalog.slice(0, limit); const observer = state.observer ?? { latitude: 0, longitude: 0, altitudeKm: 0 };
    try {
      const result = await propagateConstellation(input, observer, new Date((deps.now ?? Date.now)()), { maxObjects: 50 });
      if (!disposed && revision === constellationRevision) { state.constellation = result; publish(); }
    } catch (error) { if (!disposed && revision === constellationRevision) { state.error = errorText(error); publish(); } }
    finally { constellationRunning = false; }
  };
  const startConstellationTimer = () => {
    if (!state.active || !state.constellationEnabled || constellationTimer !== undefined) return;
    void runConstellation();
    constellationTimer = setEvery(() => { if (!disposed && state.active && state.constellationEnabled) void runConstellation(); }, 2000);
  };
  let automaticRefresh = () => {};
  const startTTLTimer = () => {
    if (!state.active || !state.initialized || ttlRefreshTimer !== undefined) return;
    if (state.catalogFetchedAt !== undefined && (deps.now ?? Date.now)() - state.catalogFetchedAt >= TTL_MS) automaticRefresh();
    ttlRefreshTimer = setEvery(() => { if (!disposed && state.active) automaticRefresh(); }, TTL_MS);
  };
  const syncGroup = async (group: ConstellationGroup, force = false) => {
    const revision = ++catalogRevision; catalogAbort?.abort(); catalogAbort = new AbortController();
    selectionRevision++; selectionAbort?.abort();
    validationRevision++; validationAbort?.abort(); validationAbort = undefined; state.validationStatus = 'idle'; state.validationRows = [];
    predictionRevision++; predictionAbort?.abort(); predictionAbort = undefined;
    constellationRevision++;
    const controller = catalogAbort; state.catalog = []; state.catalogFetchedAt = undefined; state.catalogEpoch = undefined; state.catalogAgeMs = undefined; state.catalogWarning = undefined; state.catalogProvider = undefined; state.catalogSource = undefined; state.catalogStale = false;
    clearSelection(); stopTelemetryTimers(); state.error = undefined; publish();
    try {
      // The background reminder coordinator shares this orbital group identity/cache.
      const result = await deps.data.getOrbitalData({ group, signal: controller.signal });
      if (disposed || revision !== catalogRevision || state.group !== group) return;
      state.catalog = result.elements; state.catalogFetchedAt = result.fetchedAt; state.catalogEpoch = result.elementEpoch; state.catalogAgeMs = Math.max(0, (deps.now ?? Date.now)() - result.fetchedAt); state.catalogSource = result.source; state.catalogProvider = result.provider; state.catalogWarning = result.warning; state.catalogStale = state.catalogAgeMs >= TTL_MS || result.source === 'stale-cache';
      state.initialized = true;
      const restored = pendingSelection; pendingSelection = undefined;
      publish();
      if (restored && result.elements.some(item => item.NORAD_CAT_ID === restored)) { await choose(restored); if (state.observer) await refreshPasses(); }
      else if (state.catalog.length) { /* Selection is always an explicit user action. */ }
      startTTLTimer(); startConstellationTimer();
    } catch (error) {
      if (!disposed && revision === catalogRevision && !controller.signal.aborted) { state.error = errorText(error); state.initialized = true; publish(); }
    }
  };
  let pendingSelection: number | undefined;
  automaticRefresh = () => { pendingSelection = state.selectedNoradId; void syncGroup(state.group, true); };
  const choose = async (noradId: number | null) => {
    const revision = ++selectionRevision; selectionAbort?.abort(); selectionAbort = new AbortController();
    const controller = selectionAbort; clearSelection(); stopTelemetryTimers(); state.error = undefined; state.validationStatus = 'idle'; state.validationRows = [];
    validationRevision++; validationAbort?.abort(); validationAbort = undefined;
    predictionRevision++; predictionAbort?.abort(); predictionAbort = undefined;
    constellationRevision++;
    publish();
    if (noradId === null) { persist(); startConstellationTimer(); return; }
    if (!Number.isSafeInteger(noradId) || noradId <= 0) throw new Error('Invalid NORAD ID');
    const entry = state.catalog.find(item => item.NORAD_CAT_ID === noradId);
    try {
      let elements = entry ? state.catalog : (await deps.data.getOrbitalData({ group: state.group, noradId, signal: controller.signal })).elements;
      if (disposed || revision !== selectionRevision || controller.signal.aborted) return;
      selectedElements = elements.find(item => item.NORAD_CAT_ID === noradId);
      if (!selectedElements) throw new Error('Selected NORAD ID is not in the current catalog');
      state.selectedNoradId = noradId; state.error = undefined; propagate(); startPositionTimer(); if (state.active) startGroundTrackTimer(); startConstellationTimer(); persist(); publish();
    } catch (error) {
      if (!disposed && revision === selectionRevision && !controller.signal.aborted) { state.error = errorText(error); publish(); }
    }
  };
  const setActive = (active: boolean) => {
    if (disposed || state.active === active) return;
    state.active = active; if (!active) stopAllTimers(); else { startPositionTimer(); if (state.selectedNoradId) startGroundTrackTimer(); startTTLTimer(); startConstellationTimer(); } publish();
  };
  const startGroundTrackTimer = () => {
    if (!state.active || !selectedElements || groundTrackTimer !== undefined) return;
    const refresh = () => { if (!disposed && state.active && selectedElements) { try { state.groundTrack = generateGroundTrack(selectedElements, new Date((deps.now ?? Date.now)()), { stepSeconds: 60 }); publish(); } catch (error) { state.error = errorText(error); publish(); } } };
    refresh(); groundTrackTimer = setEvery(refresh, 60_000);
  };
  const refreshPasses = async () => {
    if (!selectedElements || !state.observer) { state.passes = undefined; publish(); return; }
    const revision = ++predictionRevision; predictionAbort?.abort(); predictionAbort = new AbortController(); const controller = predictionAbort;
    try {
      const result = await (deps.predict ?? predictPasses)(selectedElements, state.observer, { start: new Date((deps.now ?? Date.now)()), horizonHours: 48, minimumElevationDeg: state.minimumElevationDeg, signal: controller.signal, maxSamples: 300_000 });
      if (!disposed && revision === predictionRevision && !controller.signal.aborted) { state.passes = result; publish(); }
    } catch (error) { if (!disposed && revision === predictionRevision && !controller.signal.aborted) { state.error = errorText(error); publish(); } }
  };
  return {
    getState: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async initialize() {
      const startingPreferenceRevision = preferenceRevision;
      let preferencesRaw: string | null = null, preferenceWarning: string | undefined;
      try { preferencesRaw = await deps.storage.getItem(APPLICATION_PREFERENCES_KEY); }
      catch (error) { preferenceWarning = `No se pudieron leer las preferencias: ${errorText(error)}`; }
      const preferences = readPreferences(preferencesRaw);
      if (disposed) return;
      if (startingPreferenceRevision === preferenceRevision) { state.group = preferences.group; state.observer = preferences.observer; state.minimumElevationDeg = preferences.minimumElevationDeg; state.leadMinutes = preferences.leadMinutes; pendingSelection = preferences.selectedNoradId; }
      await syncGroup(state.group);
      if (preferenceWarning) { state.error = state.error ? `${preferenceWarning} ${state.error}` : preferenceWarning; publish(); }
    },
    setActive,
    setQuery(query) { state.query = query.slice(0, 120); publish(); },
    async selectGroup(group) { if (!CATALOG_GROUPS.includes(group)) throw new Error('Constelación no compatible.'); if (state.group === group && state.catalog.length) return; preferenceRevision++; pendingSelection = undefined; state.group = group; persist(); await syncGroup(group); },
    async refreshCatalog() { pendingSelection = state.selectedNoradId; await syncGroup(state.group, true); },
    async selectSatellite(noradId) { await choose(noradId); if (state.observer && noradId !== null) await refreshPasses(); },
    refreshGroundTrack() { if (!selectedElements) return; try { state.groundTrack = generateGroundTrack(selectedElements, new Date((deps.now ?? Date.now)()), { stepSeconds: 60 }); startGroundTrackTimer(); publish(); } catch (error) { state.error = errorText(error); publish(); } },
    async propagateConstellation(limit = 50) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error('El límite de satélites debe estar entre 1 y 50.');
      state.constellationLimit = limit; await runConstellation(limit);
    },
    setObserver(observer, source = 'manual') { if (!validObserver(observer)) throw new Error('Las coordenadas del observador no son válidas.'); preferenceRevision++; constellationRevision++; validationRevision++; validationAbort?.abort(); validationAbort = undefined; predictionRevision++; predictionAbort?.abort(); predictionAbort = undefined; state.validationStatus = 'idle'; state.validationRows = []; state.passes = undefined; state.observer = { ...observer }; state.validationObserverSource = source; persist(); propagate(); void refreshPasses(); publish(); },
    setConstellationEnabled(enabled, limit = 50) { if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error('El límite de satélites debe estar entre 1 y 50.'); state.constellationEnabled = enabled; state.constellationLimit = limit; if (!enabled) { if (constellationTimer !== undefined) clearEvery(constellationTimer); constellationTimer = undefined; constellationRevision++; state.constellation = undefined; } else startConstellationTimer(); publish(); },
    clearObserver() { preferenceRevision++; constellationRevision++; validationRevision++; validationAbort?.abort(); validationAbort = undefined; predictionRevision++; predictionAbort?.abort(); predictionAbort = undefined; state.validationStatus = 'idle'; state.validationRows = []; state.observer = undefined; state.validationObserverSource = undefined; state.passes = undefined; persist(); propagate(); publish(); },
    setMinimumElevation(degrees) { if (!Number.isFinite(degrees) || degrees < 0 || degrees >= 90) throw new Error('La elevación mínima no es válida.'); preferenceRevision++; state.minimumElevationDeg = degrees; persist(); publish(); void refreshPasses(); },
    setLeadMinutes(minutes) { if (!Number.isInteger(minutes) || minutes < 1 || minutes > 180) throw new Error('El aviso debe configurarse entre 1 y 180 minutos.'); preferenceRevision++; state.leadMinutes = minutes; persist(); publish(); },
    refreshPasses,
    async validateSelected(provider) {
      const selected = state.selectedNoradId, element = selectedElements;
      if (!selected || !element) { state.validationStatus = 'error'; state.validationError = 'Seleccioná un satélite del catálogo antes de validarlo.'; publish(); return; }
      const revision = ++validationRevision; validationAbort?.abort(); validationAbort = new AbortController(); const controller = validationAbort;
      const source = state.observer ? state.validationObserverSource ?? 'manual' : 'calculation-origin';
      const observer = state.observer ?? { latitude: 0, longitude: 0, altitudeKm: 0 }, at = new Date(Math.floor((deps.now ?? Date.now)() / 1000) * 1000);
      state.validationStatus = 'loading'; state.validationError = undefined; state.validationRows = []; state.validationObserverSource = source; publish();
      try {
        const rows = await deps.data.validate(selected, at, observer, [element], controller.signal, provider);
        if (!disposed && revision === validationRevision && !controller.signal.aborted) { state.validationRows = rows; state.validationStatus = 'success'; publish(); }
      } catch (error) { if (!disposed && revision === validationRevision && !controller.signal.aborted) { state.validationStatus = 'error'; state.validationError = errorText(error); publish(); } }
    },
    async enableReminders() {
      if (!state.observer) throw new Error('Definí una ubicación manual o GPS antes de activar los recordatorios.');
      const settings: RefreshSettings = { observer: state.observer, noradIds: state.selectedNoradId ? [state.selectedNoradId] : [], group: state.group, leadMinutes: state.leadMinutes, minimumElevationDeg: state.minimumElevationDeg };
      const revision = ++reminderRevision;
      try {
        const result = await deps.reminders.enable(settings);
        if (disposed || revision !== reminderRevision || result && typeof result === 'object' && 'status' in result && result.status === 'superseded') return;
        state.remindersEnabled = true; state.reminderError = undefined; publish();
      } catch (error) {
        if (disposed || revision !== reminderRevision) return;
        state.remindersEnabled = false; state.reminderError = errorText(error); publish(); throw error;
      }
    },
    async disableReminders() {
      const revision = ++reminderRevision;
      try {
        await deps.reminders.disable();
        if (disposed || revision !== reminderRevision) return;
        state.remindersEnabled = false; state.reminderError = undefined; publish();
      } catch (error) {
        if (disposed || revision !== reminderRevision) return;
        state.reminderError = errorText(error); publish(); throw error;
      }
    },
    dispose() { if (disposed) return; disposed = true; catalogRevision++; selectionRevision++; predictionRevision++; validationRevision++; constellationRevision++; catalogAbort?.abort(); selectionAbort?.abort(); predictionAbort?.abort(); validationAbort?.abort(); stopAllTimers(); listeners.clear(); },
  };
}

export function visibleCatalog(state: ApplicationState): Elements[] { return filterCatalog(state.catalog, state.query); }
