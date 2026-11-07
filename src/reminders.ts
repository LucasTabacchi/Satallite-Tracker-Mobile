import type { PassWindow } from './prediction';

export type Reminder = {
  id: string;
  noradId: number;
  name: string;
  aosMs: number;
  triggerMs: number;
  leadMinutes: number;
};

const MAX_REMINDERS = 60;
const reminderId = (noradId: number, aosMs: number) => `tp7:pass:${noradId}:${aosMs}`;

export function planReminders(
  noradId: number,
  name: string,
  passes: PassWindow[],
  leadMinutes: number,
  now: Date,
  limit = MAX_REMINDERS,
): Reminder[] {
  if (!Number.isSafeInteger(noradId) || noradId <= 0) throw new Error('Invalid NORAD identifier');
  if (typeof name !== 'string' || !name.trim()) throw new Error('Invalid satellite name');
  if (!Number.isFinite(leadMinutes) || leadMinutes <= 0 || leadMinutes > 24 * 60) throw new Error('Invalid reminder lead minutes');
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('Invalid current date/time');
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > MAX_REMINDERS) throw new Error(`Invalid reminder limit (maximum ${MAX_REMINDERS})`);
  if (!Array.isArray(passes)) throw new Error('Invalid pass list');

  const nowMs = now.getTime();
  const reminders = new Map<string, Reminder>();
  for (const pass of passes) {
    if (!pass || (pass.aos !== null && (!(pass.aos.at instanceof Date) || !Number.isFinite(pass.aos.at.getTime())))) {
      throw new Error('Invalid pass AOS date');
    }
    if (!pass.aos || pass.startsVisible) continue;
    const aosMs = pass.aos.at.getTime();
    const triggerMs = aosMs - leadMinutes * 60_000;
    if (aosMs <= nowMs || triggerMs <= nowMs) continue;
    const id = reminderId(noradId, aosMs);
    if (!reminders.has(id)) reminders.set(id, { id, noradId, name: name.trim(), aosMs, triggerMs, leadMinutes });
  }
  return [...reminders.values()].sort((a, b) => a.triggerMs - b.triggerMs || a.id.localeCompare(b.id)).slice(0, limit);
}

export type ReminderPort = {
  permissionGranted(): Promise<boolean>;
  list(): Promise<Reminder[]>;
  schedule(reminder: Reminder): Promise<void>;
  cancel(id: string): Promise<void>;
};

function validateReminder(value: Reminder): void {
  if (!value || !Number.isSafeInteger(value.noradId) || value.noradId <= 0 ||
      typeof value.name !== 'string' || !value.name.trim() ||
      !Number.isSafeInteger(value.aosMs) || value.aosMs <= 0 ||
      !Number.isSafeInteger(value.triggerMs) || value.triggerMs <= 0 || value.triggerMs >= value.aosMs ||
      !Number.isFinite(value.leadMinutes) || value.leadMinutes <= 0 || value.leadMinutes > 24 * 60 ||
      value.aosMs - value.triggerMs !== value.leadMinutes * 60_000 ||
      value.id !== reminderId(value.noradId, value.aosMs)) {
    throw new Error('Invalid reminder record or stable ID');
  }
}

function validateDesired(desired: Reminder[]): void {
  if (!Array.isArray(desired) || desired.length > MAX_REMINDERS) throw new Error(`Invalid desired reminder batch (maximum ${MAX_REMINDERS})`);
  const seen = new Set<string>();
  for (const reminder of desired) {
    validateReminder(reminder);
    if (!reminder.id.startsWith('tp7:pass:')) throw new Error('Reminder ID is outside the owned namespace');
    if (seen.has(reminder.id)) throw new Error('Duplicate reminder ID');
    seen.add(reminder.id);
  }
}

function sameReminder(left: Reminder, right: Reminder): boolean {
  return left.id === right.id && left.noradId === right.noradId && left.name === right.name &&
    left.aosMs === right.aosMs && left.triggerMs === right.triggerMs && left.leadMinutes === right.leadMinutes;
}

/** Reconciles only owned reminders; each call is serialized and safe to retry after partial native failure. */
export function createReminderScheduler(port: ReminderPort): { reconcile(desired: Reminder[]): Promise<void> } {
  let tail: Promise<void> = Promise.resolve();
  const reconcileOnce = async (desired: Reminder[]) => {
    validateDesired(desired);
    if (desired.length > 0 && !(await port.permissionGranted())) throw new Error('Notification permission denied');
    const current = await port.list();
    const owned = current.filter(item => item.id.startsWith('tp7:pass:'));
    const currentById = new Map(owned.map(item => [item.id, item]));
    const desiredById = new Map(desired.map(item => [item.id, item]));
    for (const reminder of desired) {
      const existing = currentById.get(reminder.id);
      if (!existing || !sameReminder(existing, reminder)) await port.schedule(reminder);
    }
    for (const existing of owned) {
      if (!desiredById.has(existing.id)) await port.cancel(existing.id);
    }
  };
  return {
    reconcile(desired) {
      const run = tail.then(() => reconcileOnce(desired));
      tail = run.then(() => undefined, () => undefined);
      return run;
    },
  };
}
