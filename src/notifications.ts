import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

const CHANNEL_ID = "plan-reminders";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function notificationPermissionGranted() {
  const permission = await Notifications.getPermissionsAsync();
  return permission.granted;
}

export async function enablePlanNotifications() {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: "Plan reminders",
      description: "Reminders for Nook activities you are approved to attend",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 150, 250],
      lightColor: "#247064",
    });
  }
  const current = await Notifications.getPermissionsAsync();
  const permission = current.granted ? current : await Notifications.requestPermissionsAsync();
  return permission.granted;
}

export async function scheduleApprovedPlanReminder(plan: { id: string; title: string; area: string; starts_at: string }) {
  const startsAt = new Date(plan.starts_at).getTime();
  if (!Number.isFinite(startsAt)) return false;
  const reminderAt = startsAt - 2 * 60 * 60 * 1000;
  if (reminderAt <= Date.now() + 60_000) return false;
  const identifier = `plan-reminder-${plan.id}`;
  await Notifications.cancelScheduledNotificationAsync(identifier).catch(() => {});
  await Notifications.scheduleNotificationAsync({
    identifier,
    content: {
      title: `Upcoming: ${plan.title}`,
      body: `Starts in 2 hours near ${plan.area}. Confirm the public meeting point in Nook.`,
      data: { planId: plan.id, screen: "My Plans" },
      sound: "default",
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: new Date(reminderAt),
      channelId: CHANNEL_ID,
    },
  });
  return true;
}

export async function syncApprovedPlanReminders(plans: Array<{ id: string; title: string; area: string; starts_at: string; requestStatus: string }>) {
  if (!(await notificationPermissionGranted())) return 0;
  let scheduled = 0;
  for (const plan of plans.filter((item) => item.requestStatus === "approved")) {
    if (await scheduleApprovedPlanReminder(plan)) scheduled += 1;
  }
  return scheduled;
}
