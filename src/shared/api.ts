// Contrat de l'API exposée par le preload (window.mbi) et noms des canaux IPC.

import type {
  AppSnapshot,
  FiredReminder,
  Note,
  NoteInput,
  Priority,
  Project,
  ProjectInput,
  Result,
  Settings,
  Task,
  TaskInput,
  TaskStatus,
  WidgetType,
} from './types';

export type DashboardPage = 'overview' | 'tasks' | 'projects' | 'notes' | 'widgets' | 'settings';

export interface DashboardRoute {
  page: DashboardPage;
  /** Ouvre l'éditeur sur cette tâche. */
  editTaskId?: string;
  /** Ouvre l'éditeur pour une nouvelle tâche (avec valeurs par défaut éventuelles). */
  newTask?: { dueDate?: string | null; priority?: Priority; projectId?: string | null };
  noteId?: string;
}

export interface QuickAddDefaults {
  dueDate?: string | null;
  priority?: Priority;
  projectId?: string | null;
}

export type ResizeEdge = 'e' | 's' | 'se' | 'w' | 'sw';

export interface BackupInfo {
  file: string;
  date: string;
  size: number;
}

export type ImportCounts = { tasks: number; projects: number; notes: number };

export interface MbiApi {
  getSnapshot(): Promise<AppSnapshot>;
  onSnapshot(cb: (snapshot: AppSnapshot) => void): () => void;
  tasks: {
    create(input: TaskInput): Promise<Result<Task>>;
    update(id: string, patch: Partial<TaskInput>): Promise<Result<Task>>;
    remove(id: string): Promise<Result<true>>;
    toggle(id: string): Promise<Result<Task>>;
    setStatus(id: string, status: TaskStatus): Promise<Result<Task>>;
    postpone(id: string, days: number): Promise<Result<Task>>;
    duplicate(id: string): Promise<Result<Task>>;
    quickAdd(text: string, defaults?: QuickAddDefaults): Promise<Result<Task>>;
    snooze(id: string, minutes: number): Promise<Result<Task>>;
    /** Menu contextuel natif (statut, priorité, report, modifier, supprimer). */
    contextMenu(id: string): void;
  };
  projects: {
    create(input: ProjectInput): Promise<Result<Project>>;
    update(id: string, input: Partial<ProjectInput>): Promise<Result<Project>>;
    remove(id: string): Promise<Result<true>>;
  };
  notes: {
    create(input?: NoteInput): Promise<Result<Note>>;
    update(id: string, input: NoteInput): Promise<Result<Note>>;
    remove(id: string): Promise<Result<true>>;
  };
  settings: {
    update(patch: Partial<Settings>): Promise<Result<Settings>>;
  };
  widgets: {
    setVisible(type: WidgetType, visible: boolean): Promise<void>;
    setAlwaysOnTop(type: WidgetType, value: boolean): Promise<void>;
    showAll(): Promise<void>;
    hideAll(): Promise<void>;
    resetLayout(): Promise<void>;
    /** Menu « … » natif du widget courant. */
    menu(): void;
    /** Masque le widget courant. */
    hideSelf(): void;
    resizeStart(edge: ResizeEdge): void;
    resizeMove(): void;
    resizeEnd(): void;
  };
  reminders: {
    getPending(): Promise<FiredReminder[]>;
    onPending(cb: (items: FiredReminder[]) => void): () => void;
    dismiss(taskId: string, reminderId: string): void;
    dismissAll(): void;
    setPopupHeight(height: number): void;
  };
  app: {
    openDashboard(route?: DashboardRoute): void;
    openQuickAdd(): void;
    /** Ferme/masque la fenêtre courante (saisie rapide). */
    closeWindow(): void;
    onNavigate(cb: (route: DashboardRoute) => void): () => void;
    onQuickAddShown(cb: () => void): () => void;
    confirm(message: string, detail?: string): Promise<boolean>;
    exportData(): Promise<Result<string | null>>;
    importData(mode: 'replace' | 'merge'): Promise<Result<ImportCounts | null>>;
    listBackups(): Promise<BackupInfo[]>;
    backupNow(): Promise<Result<string>>;
    restoreBackup(file: string): Promise<Result<ImportCounts>>;
    openDataFolder(): void;
    reportError(message: string): void;
    /** Réactive l'intégration Windows désactivée par le garde-fou, puis redémarre l'application. */
    reenableNative(): void;
    quit(): void;
  };
}

export const IPC = {
  snapshotGet: 'snapshot:get',
  snapshotPush: 'snapshot:push',
  taskCreate: 'task:create',
  taskUpdate: 'task:update',
  taskRemove: 'task:remove',
  taskToggle: 'task:toggle',
  taskSetStatus: 'task:set-status',
  taskPostpone: 'task:postpone',
  taskDuplicate: 'task:duplicate',
  taskQuickAdd: 'task:quick-add',
  taskSnooze: 'task:snooze',
  taskContextMenu: 'task:context-menu',
  projectCreate: 'project:create',
  projectUpdate: 'project:update',
  projectRemove: 'project:remove',
  noteCreate: 'note:create',
  noteUpdate: 'note:update',
  noteRemove: 'note:remove',
  settingsUpdate: 'settings:update',
  widgetSetVisible: 'widget:set-visible',
  widgetSetOnTop: 'widget:set-on-top',
  widgetShowAll: 'widget:show-all',
  widgetHideAll: 'widget:hide-all',
  widgetReset: 'widget:reset',
  widgetMenu: 'widget:menu',
  widgetHideSelf: 'widget:hide-self',
  widgetResizeStart: 'widget:resize-start',
  widgetResizeMove: 'widget:resize-move',
  widgetResizeEnd: 'widget:resize-end',
  remindersGet: 'reminders:get',
  remindersPush: 'reminders:push',
  reminderDismiss: 'reminders:dismiss',
  reminderDismissAll: 'reminders:dismiss-all',
  reminderPopupHeight: 'reminders:popup-height',
  appOpenDashboard: 'app:open-dashboard',
  appOpenQuickAdd: 'app:open-quick-add',
  appCloseWindow: 'app:close-window',
  appNavigate: 'app:navigate',
  appQuickAddShown: 'app:quick-add-shown',
  appConfirm: 'app:confirm',
  appExport: 'app:export',
  appImport: 'app:import',
  appListBackups: 'app:list-backups',
  appBackupNow: 'app:backup-now',
  appRestoreBackup: 'app:restore-backup',
  appOpenDataFolder: 'app:open-data-folder',
  appReportError: 'app:report-error',
  appQuit: 'app:quit',
  appReenableNative: 'app:reenable-native',
} as const;
