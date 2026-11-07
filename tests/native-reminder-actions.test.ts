import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { vanguard } from './fixture';

/** Exercise the actual exported native actions with OS/provider ports replaced. */
function nativeActions() {
  const storage = new Map<string, string>();
  const permissions: Array<(granted: boolean) => void> = [];
  let registered = false;
  const notifications = {
    requestReminderPermission: () => new Promise<boolean>(resolve => permissions.push(resolve)),
    reminderScheduler: { reconcile: async () => {} },
  };
  const localRequire = createRequire(new URL('../src/native/background.ts', import.meta.url));
  const requirePort = (name: string) => {
    if (name === '@react-native-async-storage/async-storage') return { __esModule: true, default: {
      getItem: async (key: string) => storage.get(key) ?? null,
      setItem: async (key: string, value: string) => { storage.set(key, value); },
    } };
    if (name === 'expo-background-task') return { BackgroundTaskStatus: { Available: 1 }, getStatusAsync: async () => 1,
      registerTaskAsync: async () => { registered = true; }, unregisterTaskAsync: async () => { registered = false; } };
    if (name === 'expo-task-manager') return { isTaskDefined: () => true, isTaskRegisteredAsync: async () => registered };
    if (name === './notifications') return notifications;
    if (name === '../data-service') return { createDataService: () => ({ getOrbitalData: async () => ({ elements: [vanguard] }) }) };
    return localRequire(name);
  };
  const code = ts.transpileModule(readFileSync(new URL('../src/native/background.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', code)(requirePort, module, module.exports);
  return { actions: module.exports as typeof import('../src/native/background'), permissions,
    saved: () => JSON.parse(storage.get('satellite-tracker:refresh:v1') ?? 'null'), registered: () => registered, storage };
}

const settings = { observer: { latitude: 0, longitude: 0, altitudeKm: 0 }, noradIds: [5],
  group: 'stations' as const, leadMinutes: 10, minimumElevationDeg: 0 };

test('native cancellation completes while permission is pending and late grant cannot restore settings', async () => {
  const port = nativeActions();
  const pending = port.actions.enablePassReminders(settings);
  await port.actions.disablePassReminders();
  const before = JSON.stringify([...port.storage]);
  assert.equal(port.saved().settings, null);
  port.permissions[0](true);
  await pending;
  assert.equal(port.saved().settings, null);
  assert.equal(port.registered(), false);
  assert.equal(JSON.stringify([...port.storage]), before);
});

test('native latest enable wins when permission grants complete out of order', async () => {
  const port = nativeActions();
  const older = port.actions.enablePassReminders(settings);
  const latestSettings = { ...settings, leadMinutes: 15 };
  const latest = port.actions.enablePassReminders(latestSettings);
  port.permissions[1](true);
  await latest;
  port.permissions[0](true);
  await older;
  assert.equal(port.saved().settings.leadMinutes, 15);
  assert.equal(port.registered(), true);
  await port.actions.disablePassReminders();
  assert.equal(port.saved().settings, null);
  assert.equal(port.registered(), false);
});

test('native permission denial preserves existing stored bytes and can be followed by a normal enable', async () => {
  const port = nativeActions();
  const before = JSON.stringify([...port.storage]);
  const denied = port.actions.enablePassReminders(settings);
  port.permissions[0](false);
  await assert.rejects(denied, /permission|permiso/i);
  assert.equal(JSON.stringify([...port.storage]), before);
  const enabled = port.actions.enablePassReminders(settings);
  port.permissions[1](true);
  await enabled;
  assert.equal(port.saved().settings.leadMinutes, 10);
  assert.equal(port.registered(), true);
});
