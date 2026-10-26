// Accès aux tables : conversion lignes SQLite <-> objets du domaine.

import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { PRIORITIES, STATUSES, WIDGET_TYPES } from '../../shared/types';
import type { Note, Priority, Project, Reminder, Task, TaskStatus, WidgetState, WidgetType } from '../../shared/types';

type Row = Record<string, SQLInputValue>;

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}
function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(v ?? 0) || 0;
}

function parseReminders(raw: unknown): Reminder[] {
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((r) => r && typeof r === 'object' && typeof r.id === 'string' && (r.type === 'relative' || r.type === 'absolute'))
      .map((r) => ({
        id: r.id,
        type: r.type,
        offsetMinutes: typeof r.offsetMinutes === 'number' ? r.offsetMinutes : undefined,
        at: typeof r.at === 'string' ? r.at : undefined,
        firedAt: typeof r.firedAt === 'string' ? r.firedAt : null,
        snooze: r.snooze === true ? true : undefined,
      }));
  } catch {
    return [];
  }
}

function rowToTask(row: Row): Task {
  const priority = (PRIORITIES as readonly string[]).includes(str(row.priority)) ? (row.priority as Priority) : 'normal';
  const status = (STATUSES as readonly string[]).includes(str(row.status)) ? (row.status as TaskStatus) : 'todo';
  return {
    id: str(row.id),
    title: str(row.title),
    description: str(row.description),
    dueDate: strOrNull(row.due_date),
    dueTime: strOrNull(row.due_time),
    priority,
    projectId: strOrNull(row.project_id),
    status,
    reminders: parseReminders(row.reminders),
    sortOrder: num(row.sort_order),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
    completedAt: strOrNull(row.completed_at),
  };
}

function taskParams(t: Task): Record<string, SQLInputValue> {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    due_date: t.dueDate,
    due_time: t.dueTime,
    priority: t.priority,
    project_id: t.projectId,
    status: t.status,
    reminders: JSON.stringify(
      t.reminders.map((r) => ({
        id: r.id,
        type: r.type,
        offsetMinutes: r.offsetMinutes,
        at: r.at,
        firedAt: r.firedAt,
        snooze: r.snooze || undefined,
      })),
    ),
    sort_order: t.sortOrder,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
    completed_at: t.completedAt,
  };
}

export class TaskRepository {
  constructor(private readonly db: DatabaseSync) {}

  list(): Task[] {
    return (this.db.prepare('SELECT * FROM tasks ORDER BY sort_order, created_at').all() as Row[]).map(rowToTask);
  }

  get(id: string): Task | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Row | undefined;
    return row ? rowToTask(row) : null;
  }

  insert(task: Task): void {
    this.db
      .prepare(
        `INSERT INTO tasks (id, title, description, due_date, due_time, priority, project_id, status, reminders, sort_order, created_at, updated_at, completed_at)
         VALUES ($id, $title, $description, $due_date, $due_time, $priority, $project_id, $status, $reminders, $sort_order, $created_at, $updated_at, $completed_at)`,
      )
      .run(taskParams(task));
  }

  update(task: Task): void {
    this.db
      .prepare(
        `UPDATE tasks SET title=$title, description=$description, due_date=$due_date, due_time=$due_time, priority=$priority,
           project_id=$project_id, status=$status, reminders=$reminders, sort_order=$sort_order, created_at=$created_at,
           updated_at=$updated_at, completed_at=$completed_at
         WHERE id=$id`,
      )
      .run(taskParams(task));
  }

  delete(id: string): boolean {
    return Number(this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id).changes) > 0;
  }

  deleteAll(): void {
    this.db.exec('DELETE FROM tasks');
  }

  maxSortOrder(): number {
    const row = this.db.prepare('SELECT MAX(sort_order) AS m FROM tasks').get() as { m: number | null };
    return row.m ?? 0;
  }
}

function rowToProject(row: Row): Project {
  return {
    id: str(row.id),
    name: str(row.name),
    color: str(row.color) || '#6366f1',
    sortOrder: num(row.sort_order),
    createdAt: str(row.created_at),
  };
}

export class ProjectRepository {
  constructor(private readonly db: DatabaseSync) {}

  list(): Project[] {
    return (this.db.prepare('SELECT * FROM projects ORDER BY sort_order, name').all() as Row[]).map(rowToProject);
  }

  get(id: string): Project | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Row | undefined;
    return row ? rowToProject(row) : null;
  }

  findByName(name: string): Project | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE lower(name) = lower(?)').get(name) as Row | undefined;
    return row ? rowToProject(row) : null;
  }

  insert(p: Project): void {
    this.db
      .prepare('INSERT INTO projects (id, name, color, sort_order, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(p.id, p.name, p.color, p.sortOrder, p.createdAt);
  }

  update(p: Project): void {
    this.db.prepare('UPDATE projects SET name = ?, color = ?, sort_order = ? WHERE id = ?').run(p.name, p.color, p.sortOrder, p.id);
  }

  delete(id: string): boolean {
    return Number(this.db.prepare('DELETE FROM projects WHERE id = ?').run(id).changes) > 0;
  }

  deleteAll(): void {
    this.db.exec('DELETE FROM projects');
  }

  count(): number {
    return num((this.db.prepare('SELECT COUNT(*) AS c FROM projects').get() as Row).c);
  }

  maxSortOrder(): number {
    const row = this.db.prepare('SELECT MAX(sort_order) AS m FROM projects').get() as { m: number | null };
    return row.m ?? 0;
  }
}

function rowToNote(row: Row): Note {
  return {
    id: str(row.id),
    title: str(row.title),
    content: str(row.content),
    sortOrder: num(row.sort_order),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
  };
}

export class NoteRepository {
  constructor(private readonly db: DatabaseSync) {}

  list(): Note[] {
    return (this.db.prepare('SELECT * FROM notes ORDER BY sort_order, created_at').all() as Row[]).map(rowToNote);
  }

  get(id: string): Note | null {
    const row = this.db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as Row | undefined;
    return row ? rowToNote(row) : null;
  }

  insert(n: Note): void {
    this.db
      .prepare('INSERT INTO notes (id, title, content, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(n.id, n.title, n.content, n.sortOrder, n.createdAt, n.updatedAt);
  }

  update(n: Note): void {
    this.db.prepare('UPDATE notes SET title = ?, content = ?, sort_order = ?, updated_at = ? WHERE id = ?').run(n.title, n.content, n.sortOrder, n.updatedAt, n.id);
  }

  delete(id: string): boolean {
    return Number(this.db.prepare('DELETE FROM notes WHERE id = ?').run(id).changes) > 0;
  }

  deleteAll(): void {
    this.db.exec('DELETE FROM notes');
  }

  count(): number {
    return num((this.db.prepare('SELECT COUNT(*) AS c FROM notes').get() as Row).c);
  }

  maxSortOrder(): number {
    const row = this.db.prepare('SELECT MAX(sort_order) AS m FROM notes').get() as { m: number | null };
    return row.m ?? 0;
  }
}

/** Table clé/valeur JSON (paramètres, métadonnées). */
export class KeyValueRepository {
  constructor(
    private readonly db: DatabaseSync,
    private readonly table: 'settings' | 'meta',
  ) {}

  getAll(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const row of this.db.prepare(`SELECT key, value FROM ${this.table}`).all() as Row[]) {
      try {
        out[str(row.key)] = JSON.parse(str(row.value));
      } catch {
        /* valeur corrompue ignorée : la valeur par défaut s'appliquera */
      }
    }
    return out;
  }

  get<T>(key: string): T | null {
    const row = this.db.prepare(`SELECT value FROM ${this.table} WHERE key = ?`).get(key) as Row | undefined;
    if (!row) return null;
    try {
      return JSON.parse(str(row.value)) as T;
    } catch {
      return null;
    }
  }

  set(key: string, value: unknown): void {
    this.db
      .prepare(`INSERT INTO ${this.table} (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(key, JSON.stringify(value));
  }
}

export class WidgetRepository {
  constructor(private readonly db: DatabaseSync) {}

  list(): WidgetState[] {
    const out: WidgetState[] = [];
    for (const row of this.db.prepare('SELECT type, state FROM widgets').all() as Row[]) {
      const type = str(row.type) as WidgetType;
      if (!(WIDGET_TYPES as readonly string[]).includes(type)) continue;
      try {
        const s = JSON.parse(str(row.state));
        if ([s.x, s.y, s.width, s.height].every((n) => typeof n === 'number' && Number.isFinite(n))) {
          out.push({
            type,
            visible: s.visible === true,
            x: Math.round(s.x),
            y: Math.round(s.y),
            width: Math.round(s.width),
            height: Math.round(s.height),
            alwaysOnTop: s.alwaysOnTop === true,
          });
        }
      } catch {
        /* état illisible : le widget reprendra sa position par défaut */
      }
    }
    return out;
  }

  save(state: WidgetState): void {
    const { type, ...rest } = state;
    this.db
      .prepare('INSERT INTO widgets (type, state) VALUES (?, ?) ON CONFLICT(type) DO UPDATE SET state = excluded.state')
      .run(type, JSON.stringify(rest));
  }

  deleteAll(): void {
    this.db.exec('DELETE FROM widgets');
  }
}
