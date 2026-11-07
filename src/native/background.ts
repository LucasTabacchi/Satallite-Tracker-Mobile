import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { createDataService } from '../data-service';
import { CelesTrakProvider } from '../providers/celestrak';
import { WhereTheIssProvider } from '../providers/wheretheiss';
import { createRefreshCoordinator, type RefreshSettings } from '../refresh';
import { reminderScheduler, requestReminderPermission } from './notifications';
import { createReminderActions } from '../reminder-actions';

export const REFRESH_TASK = 'tp7-orbit-and-pass-refresh';
export const satelliteData = createDataService({
  storage: AsyncStorage, providers: [new CelesTrakProvider(), new WhereTheIssProvider()],
});
export const refreshCoordinator = createRefreshCoordinator({
  storage: AsyncStorage, data: satelliteData, scheduler: reminderScheduler,
  background: {
    async register() {
      if (await BackgroundTask.getStatusAsync() !== BackgroundTask.BackgroundTaskStatus.Available) {
        throw new Error('Background refresh is unavailable on this device');
      }
      await BackgroundTask.registerTaskAsync(REFRESH_TASK, { minimumInterval: 12 * 60 });
    },
    async unregister() {
      if (await TaskManager.isTaskRegisteredAsync(REFRESH_TASK)) await BackgroundTask.unregisterTaskAsync(REFRESH_TASK);
    },
  },
});

// Definition must be evaluated by the headless entry point, not by a screen lifecycle.
if (!TaskManager.isTaskDefined(REFRESH_TASK)) {
  TaskManager.defineTask(REFRESH_TASK, async () => {
    const controller = new AbortController();
    const expiration = BackgroundTask.addExpirationListener(() => controller.abort());
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      await refreshCoordinator.refresh(controller.signal);
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    } finally {
      clearTimeout(timeout);
      expiration.remove();
    }
  });
}

/** Explicit caller action; importing this module never prompts or registers a task. */
const reminderActions = createReminderActions({
  requestPermission: requestReminderPermission,
  configure: settings => refreshCoordinator.configure(settings),
  refresh: signal => refreshCoordinator.refresh(signal),
});
export const enablePassReminders = (settings: RefreshSettings) => reminderActions.enable(settings);
export const disablePassReminders = () => reminderActions.disable();
