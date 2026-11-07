import type { RefreshResult, RefreshSettings } from './refresh';

type Ports = {
  requestPermission(): Promise<boolean>;
  configure(settings: RefreshSettings | null): Promise<void>;
  refresh(signal?: AbortSignal): Promise<RefreshResult>;
};
export type ReminderActionResult = RefreshResult | { status: 'superseded' };

/** Permission waits do not hold the effects queue: cancellation stays responsive. */
export function createReminderActions(ports: Ports) {
  let revision = 0;
  let active: AbortController | undefined;
  let tail: Promise<unknown> = Promise.resolve();
  const nextIntent = () => { active?.abort(); active = new AbortController(); return { revision: ++revision, signal: active.signal }; };
  const enqueue = <T>(operation: () => Promise<T>) => {
    const run = tail.then(operation);
    tail = run.catch(() => undefined);
    return run;
  };
  return {
    async enable(settings: RefreshSettings): Promise<ReminderActionResult> {
      const intent = nextIntent();
      const snapshot = { ...settings, observer: { ...settings.observer }, noradIds: [...settings.noradIds] };
      const granted = await ports.requestPermission();
      if (intent.revision !== revision) return { status: 'superseded' };
      if (!granted) throw new Error('Permiso de notificaciones denegado.');
      return enqueue(async () => {
        if (intent.revision !== revision) return { status: 'superseded' as const };
        try {
          await ports.configure(snapshot);
          if (intent.revision !== revision) return { status: 'superseded' as const };
          const result = await ports.refresh(intent.signal);
          return intent.revision === revision ? result : { status: 'superseded' as const };
        } catch (error) {
          if (intent.revision !== revision) return { status: 'superseded' as const };
          throw error;
        }
      });
    },
    disable(): Promise<void> {
      nextIntent();
      return enqueue(() => ports.configure(null));
    },
  };
}
