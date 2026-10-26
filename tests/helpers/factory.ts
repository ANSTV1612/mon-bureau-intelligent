import type { Task } from '../../src/shared/types';

let counter = 0;

export function makeTask(partial: Partial<Task> = {}): Task {
  counter += 1;
  return {
    id: partial.id ?? `t${counter}`,
    title: partial.title ?? `Tâche ${counter}`,
    description: '',
    dueDate: null,
    dueTime: null,
    priority: 'normal',
    projectId: null,
    status: 'todo',
    reminders: [],
    sortOrder: counter,
    createdAt: new Date(2026, 9, 1, 8, 0).toISOString(),
    updatedAt: new Date(2026, 9, 1, 8, 0).toISOString(),
    completedAt: null,
    ...partial,
  };
}

/** Lundi 26 octobre 2026, 10 h 00 (heure locale). */
export const NOW = new Date(2026, 9, 26, 10, 0, 0);
