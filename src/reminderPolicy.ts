export type ReminderPlan = {id:string;title:string;area:string;starts_at:string;requestStatus:string};
export const REMINDER_PREFIX = "plan-reminder-";
export function desiredReminders(plans:ReminderPlan[],now=Date.now()) {
  return plans.filter((p)=>p.requestStatus === "approved" && Number.isFinite(Date.parse(p.starts_at)) && Date.parse(p.starts_at)-2*60*60*1000 > now+60_000);
}
