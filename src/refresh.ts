import { parseObserver, type Elements, type Observer } from './orbit';
import type { Storage } from './catalog';
import type { DataResult } from './data-service';
import { celestrakGroup } from './providers/celestrak';
import { validNoradId } from './providers/http';
import type { CatalogQuery, ConstellationGroup } from './providers/types';
import { predictPasses, type PassWindow } from './prediction';
import { planReminders, type Reminder } from './reminders';

export type RefreshSettings = {
  observer: Observer;
  noradIds: number[];
  group: ConstellationGroup;
  leadMinutes: number;
  minimumElevationDeg: number;
};
type RefreshPorts = {
  storage: Storage;
  data: { getOrbitalData(query: CatalogQuery): Promise<DataResult> };
  scheduler: { reconcile(reminders: Reminder[]): Promise<void> };
  background: { register(): Promise<void>; unregister(): Promise<void> };
  now?: () => Date;
  predict?: (element: Elements, settings: RefreshSettings, at: Date, signal?: AbortSignal) => Promise<PassWindow[]>;
};
export type RefreshResult = { status: 'disabled' | 'updated'; reminderCount: number; warnings: string[] };
const SETTINGS_KEY = 'satellite-tracker:refresh:v1';

function checkedSettings(value: RefreshSettings): RefreshSettings {
  if (!value || !value.observer || !Array.isArray(value.noradIds) ||
      value.noradIds.length < 1 || value.noradIds.length > 5 ||
      value.noradIds.some(id => !validNoradId(id)) || new Set(value.noradIds).size !== value.noradIds.length ||
      !Number.isFinite(value.leadMinutes) || value.leadMinutes <= 0 || value.leadMinutes > 1440 ||
      !Number.isFinite(value.minimumElevationDeg) || value.minimumElevationDeg < 0 || value.minimumElevationDeg >= 90) {
    throw new Error('Invalid refresh settings');
  }
  const { latitude, longitude, altitudeKm } = value.observer;
  const observer = parseObserver(String(latitude), String(longitude), String(altitudeKm * 1000));
  return { observer, noradIds: [...value.noradIds], group: celestrakGroup(value.group),
    leadMinutes: value.leadMinutes, minimumElevationDeg: value.minimumElevationDeg };
}

/** Coordinates persisted settings and native side effects in one ordered queue. */
export function createRefreshCoordinator(ports: RefreshPorts) {
  let tail: Promise<unknown> = Promise.resolve();
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = tail.then(operation);
    tail = run.catch(() => undefined);
    return run;
  }
  const predict = ports.predict ?? (async (element, settings, at, signal) => {
    const result = await predictPasses(element, settings.observer, {
      start: at, horizonHours: 48, coarseStepSeconds: 60,
      minimumElevationDeg: settings.minimumElevationDeg, maxSamples: 10_000, signal,
    });
    return result.windows;
  });
  return {
    async configure(value: RefreshSettings | null): Promise<void> {
      // Snapshot before waiting so callers cannot mutate an already accepted request.
      const settings = value === null ? null : checkedSettings(value);
      return enqueue(async () => {
        await ports.storage.setItem(SETTINGS_KEY, JSON.stringify({ version: 1, settings }));
        if (settings) await ports.background.register();
        else {
          await ports.scheduler.reconcile([]);
          await ports.background.unregister();
        }
      });
    },
    refresh(signal?: AbortSignal): Promise<RefreshResult> {
      return enqueue(async () => {
        signal?.throwIfAborted();
        const raw = await ports.storage.getItem(SETTINGS_KEY);
        let settings: RefreshSettings | null = null;
        if (raw !== null) {
          try {
            const saved = JSON.parse(raw);
            if (!saved || saved.version !== 1) throw new Error('Unknown version');
            settings = saved.settings === null ? null : checkedSettings(saved.settings);
          } catch { throw new Error('Invalid refresh settings'); }
        }
        if (!settings) return { status: 'disabled', reminderCount: 0, warnings: [] };
        const at = ports.now?.() ?? new Date();
        if (!Number.isFinite(at.getTime())) throw new Error('Invalid refresh time');
        const result = await ports.data.getOrbitalData({ group: settings.group, signal });
        const reminders: Reminder[] = [];
        for (const id of settings.noradIds) {
          signal?.throwIfAborted();
          const element = result.elements.find(row => row.NORAD_CAT_ID === id);
          if (!element) throw new Error(`Selected satellite ${id} is unavailable; reminders preserved`);
          const passes = await predict(element, settings, at, signal);
          reminders.push(...planReminders(id, element.OBJECT_NAME, passes, settings.leadMinutes, at));
        }
        signal?.throwIfAborted();
        const current = (ports.now?.() ?? new Date()).getTime();
        const desired = reminders.filter(reminder => reminder.triggerMs > current)
          .sort((a, b) => a.triggerMs - b.triggerMs || a.id.localeCompare(b.id)).slice(0, 60);
        await ports.scheduler.reconcile(desired);
        return { status: 'updated', reminderCount: desired.length, warnings: result.warning ? [result.warning] : [] };
      });
    },
  };
}
