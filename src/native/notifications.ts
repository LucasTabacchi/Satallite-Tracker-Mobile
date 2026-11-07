import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { createReminderScheduler, type Reminder, type ReminderPort } from '../reminders';
import { notificationCopy } from '../notification-copy';

const OWNER = 'tp7:pass';
const ANDROID_CHANNEL = 'pass-reminders';

/** Explicit user-action API; Android's channel is configured before the permission prompt. */
export async function requestReminderPermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL, {
      name: 'Recordatorios de pases', importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  return (await Notifications.requestPermissionsAsync()).granted;
}

function reminderFromRequest(request: Notifications.NotificationRequest): Reminder | null {
  const data = request.content.data;
  if (data?.owner !== OWNER) return null;
  const value = data.reminder;
  if (!value || typeof value !== 'object') throw new Error(`Malformed owned pass reminder metadata (${request.identifier})`);
  const reminder = value as Reminder;
  if (typeof reminder.id !== 'string' || !reminder.id.startsWith(`${OWNER}:`) ||
      !Number.isSafeInteger(reminder.noradId) || !Number.isSafeInteger(reminder.aosMs) ||
      !Number.isSafeInteger(reminder.triggerMs) || !Number.isFinite(reminder.leadMinutes) ||
      typeof reminder.name !== 'string' || reminder.id !== `${OWNER}:${reminder.noradId}:${reminder.aosMs}` ||
      reminder.noradId <= 0 || reminder.aosMs <= 0 || reminder.triggerMs <= 0 ||
      reminder.triggerMs >= reminder.aosMs || reminder.aosMs - reminder.triggerMs !== reminder.leadMinutes * 60_000 ||
      reminder.leadMinutes <= 0 || reminder.leadMinutes > 24 * 60) {
    throw new Error(`Malformed owned pass reminder metadata (${request.identifier})`);
  }
  return reminder;
}

const port: ReminderPort = {
  async permissionGranted() {
    return (await Notifications.getPermissionsAsync()).granted;
  },
  async list() {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    return scheduled.flatMap(request => {
      const reminder = reminderFromRequest(request);
      return reminder ? [reminder] : [];
    });
  },
  async schedule(reminder) {
    await Notifications.scheduleNotificationAsync({
      identifier: reminder.id,
      content: {
        ...notificationCopy(reminder.name, reminder.leadMinutes),
        data: { owner: OWNER, reminder },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(reminder.triggerMs),
        channelId: ANDROID_CHANNEL,
      },
    });
  },
  async cancel(id) {
    await Notifications.cancelScheduledNotificationAsync(id);
  },
};

export const reminderScheduler = createReminderScheduler(port);
