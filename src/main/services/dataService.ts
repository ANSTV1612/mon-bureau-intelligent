// Service de données : point d'entrée unique pour toute modification.
// Valide les entrées, applique les règles métier, écrit en base et signale les changements.
// N'importe pas Electron (testé sous Node).

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { backupDatabase, listBackups, openDatabase, transaction, type Logger } from '../storage/database';
import { KeyValueRepository, NoteRepository, ProjectRepository, TaskRepository, WidgetRepository } from '../storage/repositories';
import { DEFAULT_SETTINGS, LIMITS, PROJECT_COLORS } from '../../shared/defaults';
import { addDays, combineDateTime, toLocalDateTimeKey, todayKey } from '../../shared/dates';
import { parseQuickAdd } from '../../shared/quickParse';
import { rearmReminders } from '../../shared/reminders';
import {
  isHexColor,
  sanitizeStoredSettings,
  validateNoteInput,
  validateProjectInput,
  validateSettingsPatch,
  validateTaskInput,
  type NormalizedTaskInput,
} from '../../shared/validation';
import type {
  ExportFile,
  Note,
  Priority,
  Project,
  Reminder,
  ReminderInput,
  Result,
  Settings,
  Task,
  WidgetState,
} from '../../shared/types';

export type ChangeKind = 'tasks' | 'projects' | 'notes' | 'settings' | 'widgets';

export interface QuickAddDefaults {
  dueDate?: string | null;
  priority?: Priority;
  projectId?: string | null;
}

export interface DataServiceOptions {
  backupDir: string;
  now?: () => Date;
  log?: Logger;
}

const fail = (errors: Record<string, string>): { ok: false; errors: Record<string, string> } => ({ ok: false, errors });
const notFound = (what: string) => fail({ form: `${what} introuvable (peut-être supprimé entre-temps).` });

export class DataService extends EventEmitter {
  private readonly tasks: TaskRepository;
  private readonly projects: ProjectRepository;
  private readonly notes: NoteRepository;
  private readonly settingsRepo: KeyValueRepository;
  private readonly meta: KeyValueRepository;
  private readonly widgetRepo: WidgetRepository;
  private settingsCache: Settings | null = null;
  private readonly now: () => Date;
  private readonly log: Logger;

  constructor(
    private readonly db: DatabaseSync,
    private readonly options: DataServiceOptions,
  ) {
    super();
    this.tasks = new TaskRepository(db);
    this.projects = new ProjectRepository(db);
    this.notes = new NoteRepository(db);
    this.settingsRepo = new KeyValueRepository(db, 'settings');
    this.meta = new KeyValueRepository(db, 'meta');
    this.widgetRepo = new WidgetRepository(db);
    this.now = options.now ?? (() => new Date());
    this.log = options.log ?? (() => undefined);
  }

  private changed(kind: ChangeKind): void {
    this.emit('changed', kind);
  }

  // ---------------------------------------------------------------- Lecture

  listTasks(): Task[] {
    return this.tasks.list();
  }
  getTask(id: string): Task | null {
    return this.tasks.get(id);
  }
  listProjects(): Project[] {
    return this.projects.list();
  }
  listNotes(): Note[] {
    return this.notes.list();
  }
  getSettings(): Settings {
    if (!this.settingsCache) this.settingsCache = sanitizeStoredSettings(this.settingsRepo.getAll(), DEFAULT_SETTINGS);
    return this.settingsCache;
  }
  listWidgets(): WidgetState[] {
    return this.widgetRepo.list();
  }
  getMeta<T>(key: string): T | null {
    return this.meta.get<T>(key);
  }
  setMeta(key: string, value: unknown): void {
    this.meta.set(key, value);
  }

  // ---------------------------------------------------------------- Tâches

  private assignReminderIds(reminders: ReminderInput[]): Reminder[] {
    return reminders.map((r) => ({
      id: r.id ?? randomUUID(),
      type: r.type,
      offsetMinutes: r.type === 'relative' ? r.offsetMinutes : undefined,
      at: r.type === 'absolute' ? r.at : undefined,
      firedAt: r.firedAt ?? null,
      snooze: r.snooze || undefined,
    }));
  }

  /** Supprime les rappels « reporter » déjà déclenchés depuis plus de 24 h. */
  private pruneReminders(reminders: Reminder[]): Reminder[] {
    const limit = this.now().getTime() - 24 * 3_600_000;
    return reminders.filter((r) => !(r.snooze && r.firedAt && Date.parse(r.firedAt) < limit));
  }

  private checkProject(projectId: string | null): Record<string, string> | null {
    if (projectId && !this.projects.get(projectId)) return { projectId: "Ce projet n'existe plus." };
    return null;
  }

  private defaultReminders(input: NormalizedTaskInput, provided: boolean): ReminderInput[] {
    if (provided) return input.reminders;
    const offset = this.getSettings().defaultReminderOffset;
    if (input.dueDate && input.dueTime && offset !== null) return [{ type: 'relative', offsetMinutes: offset }];
    return [];
  }

  createTask(raw: unknown): Result<Task> {
    const v = validateTaskInput(raw);
    if (!v.ok) return v;
    const projectError = this.checkProject(v.value.projectId);
    if (projectError) return fail(projectError);
    const provided = typeof raw === 'object' && raw !== null && Array.isArray((raw as Record<string, unknown>).reminders);
    const nowIso = this.now().toISOString();
    const task: Task = {
      id: randomUUID(),
      ...v.value,
      reminders: this.assignReminderIds(this.defaultReminders(v.value, provided)),
      sortOrder: this.tasks.maxSortOrder() + 1,
      createdAt: nowIso,
      updatedAt: nowIso,
      completedAt: v.value.status === 'done' ? nowIso : null,
    };
    this.tasks.insert(task);
    this.changed('tasks');
    return { ok: true, value: task };
  }

  updateTask(id: unknown, patch: unknown): Result<Task> {
    if (typeof id !== 'string') return fail({ form: 'Identifiant invalide.' });
    if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) return fail({ form: 'Modification invalide.' });
    const existing = this.tasks.get(id);
    if (!existing) return notFound('Tâche');
    const merged: Record<string, unknown> = {
      title: existing.title,
      description: existing.description,
      dueDate: existing.dueDate,
      dueTime: existing.dueTime,
      priority: existing.priority,
      projectId: existing.projectId,
      status: existing.status,
      reminders: existing.reminders,
      ...(patch as Record<string, unknown>),
    };
    // Sans date, l'heure et les rappels relatifs n'ont plus de sens : on les retire.
    if (!merged.dueDate) {
      merged.dueTime = null;
      if (Array.isArray(merged.reminders)) {
        merged.reminders = (merged.reminders as ReminderInput[]).filter((r) => r && r.type !== 'relative');
      }
    }
    const v = validateTaskInput(merged);
    if (!v.ok) return v;
    const projectError = this.checkProject(v.value.projectId);
    if (projectError) return fail(projectError);
    const nowIso = this.now().toISOString();
    const reminders = this.pruneReminders(this.assignReminderIds(rearmReminders(existing, v.value)));
    const task: Task = {
      ...existing,
      ...v.value,
      reminders,
      updatedAt: nowIso,
      completedAt:
        v.value.status === 'done' ? (existing.status === 'done' ? existing.completedAt : nowIso) : null,
    };
    this.tasks.update(task);
    this.changed('tasks');
    return { ok: true, value: task };
  }

  setTaskStatus(id: unknown, status: unknown): Result<Task> {
    return this.updateTask(id, { status });
  }

  toggleTask(id: unknown): Result<Task> {
    if (typeof id !== 'string') return fail({ form: 'Identifiant invalide.' });
    const existing = this.tasks.get(id);
    if (!existing) return notFound('Tâche');
    return this.updateTask(id, { status: existing.status === 'done' ? 'todo' : 'done' });
  }

  /** Reporte l'échéance de `days` jours (à partir d'aujourd'hui si la tâche est en retard ou sans date). */
  postponeTask(id: unknown, days: unknown): Result<Task> {
    if (typeof id !== 'string' || typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > 365) {
      return fail({ form: 'Report invalide.' });
    }
    const existing = this.tasks.get(id);
    if (!existing) return notFound('Tâche');
    const today = todayKey(this.now());
    const base = existing.dueDate && existing.dueDate >= today ? existing.dueDate : today;
    return this.updateTask(id, { dueDate: addDays(base, days) });
  }

  duplicateTask(id: unknown): Result<Task> {
    if (typeof id !== 'string') return fail({ form: 'Identifiant invalide.' });
    const t = this.tasks.get(id);
    if (!t) return notFound('Tâche');
    return this.createTask({
      title: t.title.length + 8 <= LIMITS.titleMax ? `${t.title} (copie)` : t.title,
      description: t.description,
      dueDate: t.dueDate,
      dueTime: t.dueTime,
      priority: t.priority,
      projectId: t.projectId,
      status: 'todo',
      reminders: t.reminders.filter((r) => !r.snooze).map((r) => ({ ...r, id: undefined, firedAt: null })),
    });
  }

  deleteTask(id: unknown): Result<true> {
    if (typeof id !== 'string') return fail({ form: 'Identifiant invalide.' });
    if (!this.tasks.delete(id)) return notFound('Tâche');
    this.changed('tasks');
    return { ok: true, value: true };
  }

  /** Création depuis la saisie rapide (texte en langage naturel). */
  quickAdd(text: unknown, defaults: unknown = {}): Result<Task> {
    if (typeof text !== 'string' || !text.trim()) return fail({ title: 'Saisissez le titre de la tâche.' });
    if (text.length > 500) return fail({ title: 'Texte trop long.' });
    const d = (typeof defaults === 'object' && defaults !== null ? defaults : {}) as QuickAddDefaults;
    const parsed = parseQuickAdd(text, this.now());
    let projectId: string | null = typeof d.projectId === 'string' ? d.projectId : null;
    let createdProject = false;
    if (parsed.projectName) {
      const existing = this.projects.findByName(parsed.projectName);
      if (existing) projectId = existing.id;
      else {
        const created = this.createProject({ name: parsed.projectName }, false);
        if (!created.ok) return created;
        projectId = created.value.id;
        createdProject = true;
      }
    }
    let dueDate = parsed.dueDate ?? (typeof d.dueDate === 'string' ? d.dueDate : null);
    const dueTime = parsed.dueTime;
    if (dueTime && !dueDate) {
      // « Appeler Paul 14h » : aujourd'hui, ou demain si l'heure est déjà passée.
      const today = todayKey(this.now());
      dueDate = combineDateTime(today, dueTime) < this.now() ? addDays(today, 1) : today;
    }
    const result = this.createTask({
      title: parsed.title,
      dueDate,
      dueTime,
      priority: parsed.priority ?? d.priority ?? 'normal',
      projectId,
    });
    if (createdProject) this.changed('projects');
    return result;
  }

  /** Reporte un rappel : ajoute un rappel ponctuel dans `minutes` minutes. */
  snoozeReminder(taskId: unknown, minutes: unknown): Result<Task> {
    if (typeof taskId !== 'string' || typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 1 || minutes > 10080) {
      return fail({ form: 'Report invalide.' });
    }
    const t = this.tasks.get(taskId);
    if (!t) return notFound('Tâche');
    const at = toLocalDateTimeKey(new Date(this.now().getTime() + minutes * 60_000));
    let reminders = t.reminders.filter((r) => !(r.snooze && r.firedAt));
    if (reminders.length >= LIMITS.remindersMax) reminders = reminders.slice(1);
    reminders.push({ id: randomUUID(), type: 'absolute', at, firedAt: null, snooze: true });
    const updated: Task = { ...t, reminders, updatedAt: this.now().toISOString() };
    this.tasks.update(updated);
    this.changed('tasks');
    return { ok: true, value: updated };
  }

  /** Marque des rappels comme déclenchés (une seule notification de changement). */
  markRemindersFired(items: { taskId: string; reminderId: string }[]): void {
    if (!items.length) return;
    const firedAt = this.now().toISOString();
    transaction(this.db, () => {
      const byTask = new Map<string, Set<string>>();
      for (const it of items) {
        const set = byTask.get(it.taskId) ?? new Set<string>();
        set.add(it.reminderId);
        byTask.set(it.taskId, set);
      }
      for (const [taskId, ids] of byTask) {
        const t = this.tasks.get(taskId);
        if (!t) continue;
        t.reminders = t.reminders.map((r) => (ids.has(r.id) && !r.firedAt ? { ...r, firedAt } : r));
        this.tasks.update(t);
      }
    });
    this.changed('tasks');
  }

  // ---------------------------------------------------------------- Projets

  createProject(raw: unknown, notify = true): Result<Project> {
    if (this.projects.count() >= LIMITS.projectsMax) return fail({ name: `${LIMITS.projectsMax} projets maximum.` });
    const hasColor = typeof raw === 'object' && raw !== null && (raw as Record<string, unknown>).color !== undefined;
    const v = validateProjectInput(raw);
    if (!v.ok) return v;
    if (this.projects.findByName(v.value.name)) return fail({ name: 'Un projet porte déjà ce nom.' });
    const project: Project = {
      id: randomUUID(),
      name: v.value.name,
      color: hasColor ? v.value.color : PROJECT_COLORS[this.projects.count() % PROJECT_COLORS.length],
      sortOrder: this.projects.maxSortOrder() + 1,
      createdAt: this.now().toISOString(),
    };
    this.projects.insert(project);
    if (notify) this.changed('projects');
    return { ok: true, value: project };
  }

  updateProject(id: unknown, raw: unknown): Result<Project> {
    if (typeof id !== 'string') return fail({ form: 'Identifiant invalide.' });
    const existing = this.projects.get(id);
    if (!existing) return notFound('Projet');
    const merged = { name: existing.name, color: existing.color, ...(typeof raw === 'object' && raw ? raw : {}) };
    const v = validateProjectInput(merged);
    if (!v.ok) return v;
    const clash = this.projects.findByName(v.value.name);
    if (clash && clash.id !== id) return fail({ name: 'Un projet porte déjà ce nom.' });
    const project: Project = { ...existing, ...v.value };
    this.projects.update(project);
    this.changed('projects');
    return { ok: true, value: project };
  }

  /** Supprime un projet ; ses tâches deviennent « Sans projet » (ON DELETE SET NULL). */
  deleteProject(id: unknown): Result<true> {
    if (typeof id !== 'string') return fail({ form: 'Identifiant invalide.' });
    if (!this.projects.delete(id)) return notFound('Projet');
    this.changed('projects');
    this.changed('tasks');
    return { ok: true, value: true };
  }

  // ---------------------------------------------------------------- Notes

  createNote(raw: unknown = {}): Result<Note> {
    if (this.notes.count() >= LIMITS.notesMax) return fail({ form: `${LIMITS.notesMax} notes maximum.` });
    const v = validateNoteInput(raw ?? {});
    if (!v.ok) return v;
    const nowIso = this.now().toISOString();
    const note: Note = {
      id: randomUUID(),
      title: v.value.title ?? '',
      content: v.value.content ?? '',
      sortOrder: this.notes.maxSortOrder() + 1,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    this.notes.insert(note);
    this.changed('notes');
    return { ok: true, value: note };
  }

  updateNote(id: unknown, raw: unknown): Result<Note> {
    if (typeof id !== 'string') return fail({ form: 'Identifiant invalide.' });
    const existing = this.notes.get(id);
    if (!existing) return notFound('Note');
    const v = validateNoteInput(raw);
    if (!v.ok) return v;
    const note: Note = { ...existing, ...v.value, updatedAt: this.now().toISOString() };
    this.notes.update(note);
    this.changed('notes');
    return { ok: true, value: note };
  }

  deleteNote(id: unknown): Result<true> {
    if (typeof id !== 'string') return fail({ form: 'Identifiant invalide.' });
    if (!this.notes.delete(id)) return notFound('Note');
    this.changed('notes');
    return { ok: true, value: true };
  }

  // ---------------------------------------------------------------- Paramètres & widgets

  updateSettings(raw: unknown): Result<Settings> {
    const v = validateSettingsPatch(raw);
    if (!v.ok) return v;
    transaction(this.db, () => {
      for (const [key, value] of Object.entries(v.value)) this.settingsRepo.set(key, value);
    });
    this.settingsCache = null;
    this.changed('settings');
    return { ok: true, value: this.getSettings() };
  }

  saveWidgetState(state: WidgetState, notify = true): void {
    this.widgetRepo.save(state);
    if (notify) this.changed('widgets');
  }

  resetWidgets(): void {
    this.widgetRepo.deleteAll();
    this.changed('widgets');
  }

  // ---------------------------------------------------------------- Export / import / sauvegardes

  exportData(): ExportFile {
    const { shortcuts, ...rest } = this.getSettings();
    return {
      format: 'mon-bureau-intelligent',
      version: 1,
      exportedAt: this.now().toISOString(),
      tasks: this.tasks.list(),
      projects: this.projects.list(),
      notes: this.notes.list(),
      settings: { ...rest, shortcuts },
    };
  }

  /**
   * Importe un fichier exporté. `replace` remplace toutes les données ; `merge` ajoute les éléments
   * absents (même identifiant = ignoré). Une sauvegarde est créée avant toute modification.
   */
  importData(raw: unknown, mode: 'replace' | 'merge' = 'replace'): Result<{ tasks: number; projects: number; notes: number }> {
    if (typeof raw !== 'object' || raw === null) return fail({ form: 'Fichier invalide.' });
    const file = raw as Partial<ExportFile>;
    if (file.format !== 'mon-bureau-intelligent' || !Array.isArray(file.tasks) || !Array.isArray(file.projects) || !Array.isArray(file.notes)) {
      return fail({ form: "Ce fichier n'est pas une exportation de Mon Bureau Intelligent." });
    }
    const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64;
    const isIso = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));
    const nowIso = this.now().toISOString();

    const projects: Project[] = [];
    const projectIds = new Set<string>();
    const names = new Set<string>();
    for (const p of file.projects as unknown[]) {
      const v = validateProjectInput(p);
      const src = p as Record<string, unknown>;
      if (!v.ok || names.has(v.value.name.toLowerCase())) continue;
      const id = isId(src.id) ? src.id : randomUUID();
      names.add(v.value.name.toLowerCase());
      projectIds.add(id);
      projects.push({
        id,
        name: v.value.name,
        color: isHexColor(src.color) ? src.color : PROJECT_COLORS[projects.length % PROJECT_COLORS.length],
        sortOrder: typeof src.sortOrder === 'number' ? src.sortOrder : projects.length,
        createdAt: isIso(src.createdAt) ? src.createdAt : nowIso,
      });
    }

    const tasks: Task[] = [];
    let skipped = 0;
    for (const t of file.tasks as unknown[]) {
      const src = (t ?? {}) as Record<string, unknown>;
      const v = validateTaskInput(src);
      if (!v.ok) {
        skipped += 1;
        continue;
      }
      const projectId = v.value.projectId && (projectIds.has(v.value.projectId) || (mode === 'merge' && this.projects.get(v.value.projectId))) ? v.value.projectId : null;
      tasks.push({
        id: isId(src.id) ? src.id : randomUUID(),
        ...v.value,
        projectId,
        reminders: this.assignReminderIds(v.value.reminders),
        sortOrder: typeof src.sortOrder === 'number' ? src.sortOrder : tasks.length,
        createdAt: isIso(src.createdAt) ? src.createdAt : nowIso,
        updatedAt: isIso(src.updatedAt) ? src.updatedAt : nowIso,
        completedAt: v.value.status === 'done' ? (isIso(src.completedAt) ? src.completedAt : nowIso) : null,
      });
    }

    const notes: Note[] = [];
    for (const n of file.notes as unknown[]) {
      const src = (n ?? {}) as Record<string, unknown>;
      const v = validateNoteInput({ title: src.title ?? '', content: src.content ?? '' });
      if (!v.ok) continue;
      notes.push({
        id: isId(src.id) ? src.id : randomUUID(),
        title: v.value.title ?? '',
        content: v.value.content ?? '',
        sortOrder: typeof src.sortOrder === 'number' ? src.sortOrder : notes.length,
        createdAt: isIso(src.createdAt) ? src.createdAt : nowIso,
        updatedAt: isIso(src.updatedAt) ? src.updatedAt : nowIso,
      });
    }

    try {
      this.backup('avant-import');
    } catch (err) {
      this.log('warn', 'Sauvegarde avant import impossible', String(err));
    }

    const counts = { tasks: 0, projects: 0, notes: 0 };
    transaction(this.db, () => {
      if (mode === 'replace') {
        this.tasks.deleteAll();
        this.projects.deleteAll();
        this.notes.deleteAll();
      }
      for (const p of projects) {
        if (mode === 'merge' && (this.projects.get(p.id) || this.projects.findByName(p.name))) continue;
        this.projects.insert(p);
        counts.projects += 1;
      }
      for (const t of tasks) {
        if (mode === 'merge' && this.tasks.get(t.id)) continue;
        if (t.projectId && !this.projects.get(t.projectId)) t.projectId = null;
        this.tasks.insert(t);
        counts.tasks += 1;
      }
      for (const n of notes) {
        if (mode === 'merge' && this.notes.get(n.id)) continue;
        this.notes.insert(n);
        counts.notes += 1;
      }
      if (mode === 'replace' && file.settings && typeof file.settings === 'object') {
        for (const [key, value] of Object.entries(file.settings)) {
          const v = validateSettingsPatch({ [key]: value });
          if (v.ok) this.settingsRepo.set(key, value);
        }
      }
    });
    if (skipped) this.log('warn', `${skipped} tâche(s) invalide(s) ignorée(s) lors de l'import`);
    this.settingsCache = null;
    for (const kind of ['projects', 'tasks', 'notes', 'settings'] as ChangeKind[]) this.changed(kind);
    return { ok: true, value: counts };
  }

  backup(label: string | null = null): string {
    return backupDatabase(this.db, this.options.backupDir, label);
  }

  /** Sauvegarde quotidienne automatique (une fois par jour). */
  dailyBackupIfNeeded(): string | null {
    const today = todayKey(this.now());
    if (this.meta.get<string>('lastBackupDate') === today) return null;
    const file = this.backup();
    this.meta.set('lastBackupDate', today);
    return file;
  }

  listBackups() {
    return listBackups(this.options.backupDir);
  }

  /** Restaure une sauvegarde : ses données remplacent les données actuelles (après une sauvegarde de sécurité). */
  restoreBackup(file: unknown): Result<{ tasks: number; projects: number; notes: number }> {
    if (typeof file !== 'string') return fail({ form: 'Sauvegarde invalide.' });
    const known = this.listBackups().find((b) => b.file === file);
    if (!known) return fail({ form: 'Sauvegarde introuvable.' });
    const tmp = path.join(os.tmpdir(), `mbi-restore-${randomUUID()}.db`);
    fs.copyFileSync(known.file, tmp);
    try {
      const { db } = openDatabase(tmp, null, this.log);
      try {
        const source = new DataService(db, { backupDir: this.options.backupDir, now: this.now });
        return this.importData(source.exportData(), 'replace');
      } finally {
        db.close();
      }
    } finally {
      for (const ext of ['', '-wal', '-shm']) fs.rmSync(tmp + ext, { force: true });
    }
  }

  close(): void {
    this.db.close();
  }
}

