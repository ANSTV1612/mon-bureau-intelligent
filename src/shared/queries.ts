// Requêtes sur les tâches : vues des widgets, filtres, tri, regroupements.

import { PRIORITY_RANK } from './defaults';
import { addDays, combineDateTime, diffDays, todayKey } from './dates';
import type { Priority, Project, Task, TaskStatus } from './types';

export function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

export function isDone(task: Task): boolean {
  return task.status === 'done';
}

/** Moment exact de l'échéance (fin de journée si pas d'heure). */
export function dueMoment(task: Pick<Task, 'dueDate' | 'dueTime'>): Date | null {
  if (!task.dueDate) return null;
  return combineDateTime(task.dueDate, task.dueTime ?? '23:59');
}

export function isOverdue(task: Task, now: Date = new Date()): boolean {
  if (isDone(task) || !task.dueDate) return false;
  const today = todayKey(now);
  if (task.dueDate < today) return true;
  if (task.dueDate === today && task.dueTime) return combineDateTime(task.dueDate, task.dueTime) < now;
  return false;
}

export function isDueToday(task: Task, now: Date = new Date()): boolean {
  return task.dueDate === todayKey(now);
}

export function completedOn(task: Task, dateKey: string): boolean {
  if (!task.completedAt) return false;
  return todayKey(new Date(task.completedAt)) === dateKey;
}

/** Tri par défaut : en cours d'abord, puis échéance la plus proche, puis priorité, puis ordre de création. */
export function compareTasks(a: Task, b: Task): number {
  if (isDone(a) !== isDone(b)) return isDone(a) ? 1 : -1;
  if (isDone(a) && isDone(b)) return (b.completedAt ?? '').localeCompare(a.completedAt ?? '');
  if (a.status !== b.status) {
    if (a.status === 'in_progress') return -1;
    if (b.status === 'in_progress') return 1;
  }
  const da = a.dueDate ? `${a.dueDate}T${a.dueTime ?? '99:99'}` : '9999';
  const db = b.dueDate ? `${b.dueDate}T${b.dueTime ?? '99:99'}` : '9999';
  if (da !== db) return da < db ? -1 : 1;
  const pr = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
  if (pr !== 0) return pr;
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.createdAt.localeCompare(b.createdAt);
}

export type SortKey = 'smart' | 'due' | 'priority' | 'created' | 'title';

export function sortTasks(tasks: Task[], key: SortKey = 'smart'): Task[] {
  const list = [...tasks];
  switch (key) {
    case 'smart':
      return list.sort(compareTasks);
    case 'due':
      return list.sort((a, b) => {
        const da = a.dueDate ? `${a.dueDate}T${a.dueTime ?? '99:99'}` : '9999';
        const db = b.dueDate ? `${b.dueDate}T${b.dueTime ?? '99:99'}` : '9999';
        return da === db ? compareTasks(a, b) : da < db ? -1 : 1;
      });
    case 'priority':
      return list.sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || compareTasks(a, b));
    case 'created':
      return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    case 'title':
      return list.sort((a, b) => a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' }));
  }
}

/** Widget « Aujourd'hui » : tâches du jour et en retard (non terminées), + terminées aujourd'hui. */
export function todayView(tasks: Task[], now: Date = new Date(), includeDone = true) {
  const today = todayKey(now);
  const overdue = tasks.filter((t) => !isDone(t) && t.dueDate !== null && t.dueDate < today);
  const pending = tasks.filter((t) => !isDone(t) && t.dueDate === today);
  const done = includeDone ? tasks.filter((t) => isDone(t) && (t.dueDate === today || completedOn(t, today))) : [];
  return {
    overdue: sortTasks(overdue),
    pending: sortTasks(pending),
    done: sortTasks(done),
  };
}

/** Widget « À venir » : tâches non terminées des `days` prochains jours (après aujourd'hui), regroupées par jour. */
export function upcomingView(tasks: Task[], now: Date = new Date(), days = 7): { date: string; tasks: Task[] }[] {
  const today = todayKey(now);
  const end = addDays(today, days);
  const groups = new Map<string, Task[]>();
  for (const t of tasks) {
    if (isDone(t) || !t.dueDate || t.dueDate <= today || t.dueDate > end) continue;
    const list = groups.get(t.dueDate) ?? [];
    list.push(t);
    groups.set(t.dueDate, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, list]) => ({ date, tasks: sortTasks(list) }));
}

/** Widget « Priorités » : tâches urgentes et élevées non terminées. */
export function prioritiesView(tasks: Task[]): Task[] {
  return tasks
    .filter((t) => !isDone(t) && (t.priority === 'urgent' || t.priority === 'high'))
    .sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || compareTasks(a, b));
}

export interface ProjectGroup {
  project: Project | null;
  tasks: Task[];
  total: number;
  done: number;
}

/** Widget « Projets » : regroupement par projet (« Sans projet » en dernier). */
export function groupByProject(tasks: Task[], projects: Project[], includeDone = false): ProjectGroup[] {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const groups = new Map<string | null, Task[]>();
  for (const p of projects) groups.set(p.id, []);
  groups.set(null, []);
  for (const t of tasks) {
    const key = t.projectId && byId.has(t.projectId) ? t.projectId : null;
    groups.get(key)!.push(t);
  }
  const result: ProjectGroup[] = [];
  const ordered = [...projects].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'fr'));
  for (const p of [...ordered, null]) {
    const all = groups.get(p ? p.id : null) ?? [];
    if (!p && all.length === 0) continue;
    const visible = includeDone ? all : all.filter((t) => !isDone(t));
    result.push({
      project: p,
      tasks: sortTasks(visible),
      total: all.length,
      done: all.filter(isDone).length,
    });
  }
  return result;
}

export type DueFilter = 'all' | 'overdue' | 'today' | 'week' | 'upcoming' | 'nodate';

export interface TaskFilter {
  search?: string;
  status?: TaskStatus | 'open' | 'all';
  priority?: Priority | 'all';
  projectId?: string | 'none' | 'all';
  due?: DueFilter;
}

export function filterTasks(tasks: Task[], filter: TaskFilter, projects: Project[] = [], now: Date = new Date()): Task[] {
  const today = todayKey(now);
  const weekEnd = addDays(today, 7);
  const q = filter.search ? normalizeSearch(filter.search) : '';
  const terms = q.split(/\s+/).filter(Boolean);
  const projectNames = new Map(projects.map((p) => [p.id, normalizeSearch(p.name)]));
  return tasks.filter((t) => {
    if (filter.status && filter.status !== 'all') {
      if (filter.status === 'open') {
        if (isDone(t)) return false;
      } else if (t.status !== filter.status) return false;
    }
    if (filter.priority && filter.priority !== 'all' && t.priority !== filter.priority) return false;
    if (filter.projectId && filter.projectId !== 'all') {
      if (filter.projectId === 'none') {
        if (t.projectId) return false;
      } else if (t.projectId !== filter.projectId) return false;
    }
    switch (filter.due ?? 'all') {
      case 'overdue':
        if (!isOverdue(t, now)) return false;
        break;
      case 'today':
        if (t.dueDate !== today) return false;
        break;
      case 'week':
        if (!t.dueDate || t.dueDate < today || t.dueDate > weekEnd) return false;
        break;
      case 'upcoming':
        if (!t.dueDate || t.dueDate <= today) return false;
        break;
      case 'nodate':
        if (t.dueDate) return false;
        break;
      default:
        break;
    }
    if (terms.length) {
      const hay = `${normalizeSearch(t.title)} ${normalizeSearch(t.description)} ${t.projectId ? projectNames.get(t.projectId) ?? '' : ''}`;
      if (!terms.every((term) => hay.includes(term))) return false;
    }
    return true;
  });
}

export interface Stats {
  total: number;
  done: number;
  remaining: number;
  inProgress: number;
  overdue: number;
  dueToday: number;
  doneToday: number;
  /** Tâches non terminées dues aujourd'hui ou en retard. */
  remainingToday: number;
  doneThisWeek: number;
  completionRate: number;
  /** Progression du jour : terminées aujourd'hui / (terminées aujourd'hui + restantes pour aujourd'hui). */
  todayRate: number;
  last7Days: { date: string; count: number }[];
  streak: number;
  byPriority: Record<Priority, number>;
}

export function computeStats(tasks: Task[], now: Date = new Date()): Stats {
  const today = todayKey(now);
  const doneTasks = tasks.filter(isDone);
  const open = tasks.filter((t) => !isDone(t));
  const doneDays = new Map<string, number>();
  for (const t of doneTasks) {
    if (!t.completedAt) continue;
    const key = todayKey(new Date(t.completedAt));
    doneDays.set(key, (doneDays.get(key) ?? 0) + 1);
  }
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(today, i - 6);
    return { date, count: doneDays.get(date) ?? 0 };
  });
  const doneToday = doneDays.get(today) ?? 0;
  const weekStart = addDays(today, -6);
  let doneThisWeek = 0;
  for (const [date, count] of doneDays) if (date >= weekStart && date <= today) doneThisWeek += count;

  // Série : jours consécutifs avec au moins une tâche terminée (aujourd'hui peut encore être vide).
  let streak = 0;
  let cursor = doneToday > 0 ? today : addDays(today, -1);
  while ((doneDays.get(cursor) ?? 0) > 0) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }

  const remainingToday = open.filter((t) => t.dueDate !== null && t.dueDate <= today).length;
  const byPriority: Record<Priority, number> = { low: 0, normal: 0, high: 0, urgent: 0 };
  for (const t of open) byPriority[t.priority] += 1;

  return {
    total: tasks.length,
    done: doneTasks.length,
    remaining: open.length,
    inProgress: open.filter((t) => t.status === 'in_progress').length,
    overdue: open.filter((t) => isOverdue(t, now)).length,
    dueToday: open.filter((t) => t.dueDate === today).length,
    doneToday,
    remainingToday,
    doneThisWeek,
    completionRate: tasks.length ? doneTasks.length / tasks.length : 0,
    todayRate: doneToday + remainingToday ? doneToday / (doneToday + remainingToday) : 0,
    last7Days,
    streak,
    byPriority,
  };
}

/** Nombre de jours de retard (0 si pas en retard). */
export function overdueDays(task: Task, now: Date = new Date()): number {
  if (!task.dueDate || isDone(task)) return 0;
  return Math.max(0, diffDays(task.dueDate, todayKey(now)));
}
