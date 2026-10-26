// Planificateur des rappels et du résumé quotidien.
// Vérification périodique (robuste à la mise en veille et aux changements d'horloge) + minuterie
// précise calée sur le prochain rappel. N'importe pas Electron.

import { formatDue, todayKey } from '../../shared/dates';
import { collectDueReminders, isDigestDue, nextReminderTime } from '../../shared/reminders';
import { isOverdue } from '../../shared/queries';
import type { FiredReminder } from '../../shared/types';
import type { DataService } from './dataService';

export interface DigestSummary {
  dueToday: number;
  overdue: number;
  urgent: number;
  titles: string[];
}

export interface SchedulerHandlers {
  onFired(items: FiredReminder[]): void;
  onDigest(summary: DigestSummary): void;
}

const CHECK_INTERVAL = 20_000;

export class ReminderScheduler {
  private interval: NodeJS.Timeout | null = null;
  private precise: NodeJS.Timeout | null = null;

  constructor(
    private readonly data: DataService,
    private readonly handlers: SchedulerHandlers,
    private readonly now: () => Date = () => new Date(),
  ) {}

  start(): void {
    this.stop();
    this.interval = setInterval(() => this.tick(), CHECK_INTERVAL);
    this.tick();
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    if (this.precise) clearTimeout(this.precise);
    this.interval = null;
    this.precise = null;
  }

  /** Vérifie les rappels dus. Appelé régulièrement, au réveil du PC et après chaque modification. */
  tick(): FiredReminder[] {
    const now = this.now();
    const settings = this.data.getSettings();
    const tasks = this.data.listTasks();
    const { due, expired } = collectDueReminders(tasks, now, settings.defaultReminderTime);

    if (due.length || expired.length) {
      this.data.markRemindersFired([...due, ...expired].map((r) => ({ taskId: r.task.id, reminderId: r.reminder.id })));
    }
    const fired: FiredReminder[] = due.map((r) => ({
      taskId: r.task.id,
      reminderId: r.reminder.id,
      title: r.task.title,
      dueLabel: r.task.dueDate ? formatDue(r.task.dueDate, r.task.dueTime, now) : '',
      priority: r.task.priority,
      firedAt: now.toISOString(),
    }));
    if (fired.length) this.handlers.onFired(fired);

    if (settings.dailyDigest && isDigestDue(now, settings.dailyDigestTime, this.data.getMeta<string>('lastDigestDate'))) {
      this.data.setMeta('lastDigestDate', todayKey(now));
      const today = todayKey(now);
      const open = tasks.filter((t) => t.status !== 'done');
      const dueToday = open.filter((t) => t.dueDate === today);
      const overdue = open.filter((t) => isOverdue(t, now) && t.dueDate !== today);
      if (dueToday.length || overdue.length) {
        this.handlers.onDigest({
          dueToday: dueToday.length,
          overdue: overdue.length,
          urgent: [...dueToday, ...overdue].filter((t) => t.priority === 'urgent').length,
          titles: [...overdue, ...dueToday].slice(0, 3).map((t) => t.title),
        });
      }
    }

    this.schedulePrecise(now);
    return fired;
  }

  private schedulePrecise(now: Date): void {
    if (this.precise) clearTimeout(this.precise);
    this.precise = null;
    if (!this.interval) return;
    const next = nextReminderTime(this.data.listTasks(), now, this.data.getSettings().defaultReminderTime);
    if (!next) return;
    const delay = next.getTime() - now.getTime();
    if (delay > 0 && delay <= CHECK_INTERVAL) this.precise = setTimeout(() => this.tick(), delay + 50);
  }
}
