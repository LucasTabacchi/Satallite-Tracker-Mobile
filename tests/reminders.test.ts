import assert from 'node:assert/strict';
import test from 'node:test';
import { createReminderScheduler, planReminders, type Reminder, type ReminderPort } from '../src/reminders';
import type { PassWindow } from '../src/prediction';

const now = new Date('2026-10-28T12:00:00Z');
const pass = (aos: string | null, startsVisible = false): PassWindow => ({
  aos: aos ? { at: new Date(aos), azimuthDeg: 20, elevationDeg: 0 } : null,
  los: null,
  maximum: { at: now, azimuthDeg: 20, elevationDeg: 40 },
  samples: [], startsVisible, endsVisible: false, continuous: startsVisible,
});

test('plans only future real AOS notifications and returns stable sorted unique IDs', () => {
  const result = planReminders(25544, 'ISS', [
    pass('2026-10-28T12:20:00Z'), pass('2026-10-28T12:30:00Z'), pass(null, true),
    pass('2026-10-28T12:03:00Z'), pass('2026-10-28T12:20:00Z'),
  ], 5, now);
  assert.deepEqual(result, [
    { id: 'tp7:pass:25544:1793190000000', noradId: 25544, name: 'ISS', aosMs: 1793190000000, triggerMs: 1793189700000, leadMinutes: 5 },
    { id: 'tp7:pass:25544:1793190600000', noradId: 25544, name: 'ISS', aosMs: 1793190600000, triggerMs: 1793190300000, leadMinutes: 5 },
  ]);
});

test('validates reminder planning arguments and enforces a maximum of 60', () => {
  assert.throws(() => planReminders(0, 'ISS', [], 5, now), /NORAD/i);
  assert.throws(() => planReminders(25544, 'ISS', [], -1, now), /lead/i);
  assert.throws(() => planReminders(25544, 'ISS', [], 5, new Date(NaN)), /date|time/i);
  assert.throws(() => planReminders(25544, 'ISS', [], 5, now, 61), /limit/i);
});

function fakePort(initial: Reminder[] = [], permission = true) {
  const events: string[] = [];
  const entries = new Map(initial.map(item => [item.id, item]));
  const port: ReminderPort = {
    permissionGranted: async () => permission,
    list: async () => [...entries.values()],
    schedule: async item => { events.push(`schedule:${item.id}`); entries.set(item.id, item); },
    cancel: async id => { events.push(`cancel:${id}`); entries.delete(id); },
  };
  return { port, events, entries };
}

const reminder = (offsetMs: number, name = 'ISS'): Reminder => {
  const aosMs = 1_800_000_000_000 + offsetMs;
  return { id: `tp7:pass:25544:${aosMs}`, noradId: 25544, name, aosMs, triggerMs: aosMs - 300_000, leadMinutes: 5 };
};

test('reconcile is idempotent and only cancels obsolete owned notifications', async () => {
  const old = reminder(1000);
  const unchanged = reminder(2000);
  const { port, events } = fakePort([old, unchanged, { ...old, id: 'other:notification' }]);
  const scheduler = createReminderScheduler(port);
  await scheduler.reconcile([unchanged, reminder(3000)]);
  assert.deepEqual(events, [`schedule:${reminder(3000).id}`, `cancel:${old.id}`]);
  await scheduler.reconcile([unchanged, reminder(3000)]);
  assert.equal(events.length, 2);
  assert.ok((await port.list()).some(item => item.id === 'other:notification'));
});

test('replaces changed reminder details under the stable pass identifier', async () => {
  const old = reminder(1000);
  const changed = reminder(1000, 'ISS updated');
  const { port, events } = fakePort([old]);
  await createReminderScheduler(port).reconcile([changed]);
  assert.deepEqual(events, [`schedule:${changed.id}`]);
});

test('validates the entire desired batch before touching the port', async () => {
  const { port, events } = fakePort();
  const scheduler = createReminderScheduler(port);
  await assert.rejects(scheduler.reconcile([reminder(1000), { ...reminder(2000), id: 'forged' }]), /reminder|id/i);
  assert.deepEqual(events, []);
});

test('permission denial rejects nonempty plans without mutations but permits empty-plan cleanup', async () => {
  const { port, events } = fakePort([reminder(1000)], false);
  const scheduler = createReminderScheduler(port);
  await assert.rejects(scheduler.reconcile([reminder(2000)]), /permission/i);
  assert.deepEqual(events, []);
  await scheduler.reconcile([]);
  assert.deepEqual(events, [`cancel:${reminder(1000).id}`]);
});

test('schedules replacements before removing obsolete reminders and propagates native errors', async () => {
  const old = reminder(1000);
  const replacement = reminder(2000);
  const { port, events } = fakePort([old]);
  port.schedule = async item => { events.push(`schedule:${item.id}`); throw new Error('native schedule failed'); };
  const scheduler = createReminderScheduler(port);
  await assert.rejects(scheduler.reconcile([replacement]), /native schedule failed/);
  assert.deepEqual(events, [`schedule:${replacement.id}`]);
});

test('serializes overlapping reconciliation calls', async () => {
  const events: string[] = [];
  const entries = new Map<string, Reminder>();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let notifyStarted!: () => void;
  const started = new Promise<void>(resolve => { notifyStarted = resolve; });
  let firstSchedule = true;
  const port: ReminderPort = {
    permissionGranted: async () => true,
    list: async () => [...entries.values()],
    schedule: async item => {
      events.push(`schedule-start:${item.id}`);
      notifyStarted();
      if (firstSchedule) { firstSchedule = false; await gate; }
      entries.set(item.id, item);
      events.push(`schedule-end:${item.id}`);
    },
    cancel: async id => { events.push(`cancel:${id}`); entries.delete(id); },
  };
  const scheduler = createReminderScheduler(port);
  const first = scheduler.reconcile([reminder(1000)]);
  const second = scheduler.reconcile([reminder(2000)]);
  await started;
  assert.deepEqual(events, [`schedule-start:${reminder(1000).id}`]);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(events, [
    `schedule-start:${reminder(1000).id}`, `schedule-end:${reminder(1000).id}`,
    `schedule-start:${reminder(2000).id}`, `schedule-end:${reminder(2000).id}`,
    `cancel:${reminder(1000).id}`,
  ]);
});
