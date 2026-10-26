// Calcul des rappels : moment de déclenchement, rappels dus, prochains rappels.

import { combineDateTime, formatOffset, formatShortDate, parseLocalDateTime, todayKey } from './dates';
import type { Reminder, ReminderInput, Task } from './types';

export interface ScheduledReminder {
  task: Task;
  reminder: Reminder;
  fireAt: Date;
}

/** Retard maximal toléré : un rappel manqué (PC éteint) depuis plus longtemps est ignoré silencieusement. */
export const MAX_LATE_MINUTES = 12 * 60;

export function reminderFireTime(
  task: Pick<Task, 'dueDate' | 'dueTime'>,
  reminder: Pick<Reminder, 'type' | 'offsetMinutes' | 'at'>,
  defaultTime: string,
): Date | null {
  if (reminder.type === 'absolute') return reminder.at ? parseLocalDateTime(reminder.at) : null;
  if (!task.dueDate) return null;
  const anchor = combineDateTime(task.dueDate, task.dueTime ?? defaultTime);
  return new Date(anchor.getTime() - (reminder.offsetMinutes ?? 0) * 60_000);
}

function pendingReminders(tasks: Task[], defaultTime: string): ScheduledReminder[] {
  const out: ScheduledReminder[] = [];
  for (const task of tasks) {
    if (task.status === 'done') continue;
    for (const reminder of task.reminders) {
      if (reminder.firedAt) continue;
      const fireAt = reminderFireTime(task, reminder, defaultTime);
      if (fireAt) out.push({ task, reminder, fireAt });
    }
  }
  return out.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime());
}

/**
 * Rappels à déclencher maintenant (`due`) et rappels trop anciens à marquer comme traités sans
 * notification (`expired`).
 */
export function collectDueReminders(
  tasks: Task[],
  now: Date,
  defaultTime: string,
  maxLateMinutes = MAX_LATE_MINUTES,
): { due: ScheduledReminder[]; expired: ScheduledReminder[] } {
  const due: ScheduledReminder[] = [];
  const expired: ScheduledReminder[] = [];
  const limit = now.getTime() - maxLateMinutes * 60_000;
  for (const item of pendingReminders(tasks, defaultTime)) {
    const t = item.fireAt.getTime();
    if (t > now.getTime()) break;
    if (t < limit) expired.push(item);
    else due.push(item);
  }
  return { due, expired };
}

export function nextReminderTime(tasks: Task[], now: Date, defaultTime: string): Date | null {
  const next = pendingReminders(tasks, defaultTime).find((r) => r.fireAt.getTime() > now.getTime());
  return next ? next.fireAt : null;
}

export function upcomingReminders(tasks: Task[], now: Date, defaultTime: string, horizonHours = 72): ScheduledReminder[] {
  const end = now.getTime() + horizonHours * 3_600_000;
  return pendingReminders(tasks, defaultTime).filter((r) => r.fireAt.getTime() > now.getTime() && r.fireAt.getTime() <= end);
}

/** Rappels déclenchés récemment pour des tâches encore ouvertes (widget « Rappels »). */
export function recentFiredReminders(tasks: Task[], now: Date, hours = 24): ScheduledReminder[] {
  const start = now.getTime() - hours * 3_600_000;
  const out: ScheduledReminder[] = [];
  for (const task of tasks) {
    if (task.status === 'done') continue;
    for (const reminder of task.reminders) {
      if (!reminder.firedAt) continue;
      const fired = new Date(reminder.firedAt);
      if (fired.getTime() >= start) out.push({ task, reminder, fireAt: fired });
    }
  }
  return out.sort((a, b) => b.fireAt.getTime() - a.fireAt.getTime());
}

/**
 * Quand l'échéance d'une tâche change, ses rappels relatifs doivent pouvoir se redéclencher :
 * on efface leur état « déclenché ». Les rappels absolus modifiés sont aussi réarmés.
 */
export function rearmReminders(
  previous: Pick<Task, 'dueDate' | 'dueTime' | 'reminders'> | null,
  next: { dueDate: string | null; dueTime: string | null; reminders: ReminderInput[] },
): ReminderInput[] {
  const dueChanged = !previous || previous.dueDate !== next.dueDate || previous.dueTime !== next.dueTime;
  const prevById = new Map((previous?.reminders ?? []).map((r) => [r.id, r]));
  return next.reminders.map((r) => {
    const prev = r.id ? prevById.get(r.id) : undefined;
    if (r.type === 'relative') {
      if (dueChanged || !prev || prev.offsetMinutes !== r.offsetMinutes) return { ...r, firedAt: null };
      return { ...r, firedAt: prev.firedAt };
    }
    if (!prev || prev.at !== r.at) return { ...r, firedAt: null };
    return { ...r, firedAt: prev.firedAt };
  });
}

export function describeReminder(reminder: Pick<Reminder, 'type' | 'offsetMinutes' | 'at'>, now: Date = new Date()): string {
  if (reminder.type === 'relative') return formatOffset(reminder.offsetMinutes ?? 0);
  if (!reminder.at) return 'Rappel';
  const [date, time] = reminder.at.split('T');
  return `${formatShortDate(date, now)} à ${time}`;
}

/** Le résumé quotidien doit-il être envoyé maintenant ? */
export function isDigestDue(now: Date, digestTime: string, lastDigestDate: string | null): boolean {
  const today = todayKey(now);
  if (lastDigestDate === today) return false;
  const at = combineDateTime(today, digestTime);
  // Fenêtre de 6 h après l'heure prévue (au-delà, le résumé du jour est sauté).
  return now >= at && now.getTime() - at.getTime() < 6 * 3_600_000;
}
