// Types du domaine partagés entre le processus principal, le preload et l'interface.

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const STATUSES = ['todo', 'in_progress', 'done'] as const;
export type TaskStatus = (typeof STATUSES)[number];

/**
 * Rappel d'une tâche.
 * - relative : déclenché `offsetMinutes` avant l'échéance (date + heure, ou heure par défaut si pas d'heure).
 * - absolute : déclenché à une date/heure locale précise (`at`, format AAAA-MM-JJTHH:mm).
 */
export interface Reminder {
  id: string;
  type: 'relative' | 'absolute';
  offsetMinutes?: number;
  at?: string;
  /** Horodatage ISO du déclenchement, null si pas encore déclenché. */
  firedAt: string | null;
  /** Rappel créé par un « Reporter » : supprimé automatiquement une fois déclenché et traité. */
  snooze?: boolean;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  /** Date locale AAAA-MM-JJ, ou null pour une tâche sans échéance. */
  dueDate: string | null;
  /** Heure locale HH:mm, ou null. */
  dueTime: string | null;
  priority: Priority;
  projectId: string | null;
  status: TaskStatus;
  reminders: Reminder[];
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

/** Données saisies par l'utilisateur pour créer / modifier une tâche. */
export interface TaskInput {
  title: string;
  description?: string;
  dueDate?: string | null;
  dueTime?: string | null;
  priority?: Priority;
  projectId?: string | null;
  status?: TaskStatus;
  reminders?: ReminderInput[];
}

export interface ReminderInput {
  id?: string;
  type: 'relative' | 'absolute';
  offsetMinutes?: number;
  at?: string;
  firedAt?: string | null;
  snooze?: boolean;
}

export interface Project {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  createdAt: string;
}

export interface ProjectInput {
  name: string;
  color?: string;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface NoteInput {
  title?: string;
  content?: string;
}

export const WIDGET_TYPES = [
  'tasks',
  'today',
  'upcoming',
  'priorities',
  'projects',
  'notes',
  'reminders',
  'progress',
] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

export interface WidgetState {
  type: WidgetType;
  visible: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  alwaysOnTop: boolean;
}

export type ThemeMode = 'system' | 'light' | 'dark';
export type FontScale = 'compact' | 'normal' | 'large';

export interface ShortcutSettings {
  quickAdd: string;
  toggleWidgets: string;
  openDashboard: string;
}

export interface Settings {
  theme: ThemeMode;
  accentColor: string;
  /** Opacité du fond des widgets (0.4 à 1). */
  widgetOpacity: number;
  fontScale: FontScale;
  animations: boolean;
  launchAtStartup: boolean;
  /** Au démarrage manuel, ouvrir le tableau de bord (au démarrage Windows, il reste masqué). */
  showDashboardOnStart: boolean;
  closeToTray: boolean;
  nativeNotifications: boolean;
  reminderPopup: boolean;
  reminderSound: boolean;
  dailyDigest: boolean;
  dailyDigestTime: string;
  /** Heure utilisée pour les rappels relatifs d'une tâche sans heure. */
  defaultReminderTime: string;
  /** Rappel ajouté automatiquement aux nouvelles tâches avec heure (minutes avant), null = aucun. */
  defaultReminderOffset: number | null;
  snoozeMinutes: number;
  /** Windows : les widgets « bureau » restent visibles quand on affiche le bureau (Win+D, clic sur le fond d'écran). */
  desktopAnchor: boolean;
  /** Les widgets « au premier plan » s'effacent devant les fenêtres maximisées ou en plein écran. */
  discreetMode: boolean;
  /** Les widgets deviennent plus transparents quand la souris n'est pas dessus. */
  fadeInactiveWidgets: boolean;
  lockWidgets: boolean;
  /** Aimantation des widgets aux bords de l'écran. */
  snapWidgets: boolean;
  upcomingDays: number;
  showCompletedInWidgets: boolean;
  confirmDelete: boolean;
  shortcuts: ShortcutSettings;
}

export interface ShortcutStatus {
  quickAdd: boolean;
  toggleWidgets: boolean;
  openDashboard: boolean;
}

export interface AppInfo {
  version: string;
  platform: string;
  dataPath: string;
  isPortable: boolean;
  nativeDesktopSupport: boolean;
  /** Intégration Windows désactivée automatiquement par le garde-fou (raison), sinon null. */
  nativeDisabledReason: string | null;
  autoStartSupported: boolean;
  shortcutStatus: ShortcutStatus;
  storageWarning: string | null;
}

/** Instantané complet de l'état, diffusé à toutes les fenêtres à chaque modification. */
export interface AppSnapshot {
  tasks: Task[];
  projects: Project[];
  notes: Note[];
  settings: Settings;
  widgets: WidgetState[];
  info: AppInfo;
  revision: number;
}

export interface FiredReminder {
  taskId: string;
  reminderId: string;
  title: string;
  dueLabel: string;
  priority: Priority;
  firedAt: string;
}

export interface ExportFile {
  format: 'mon-bureau-intelligent';
  version: 1;
  exportedAt: string;
  tasks: Task[];
  projects: Project[];
  notes: Note[];
  settings: Partial<Settings>;
}

export type Result<T> = { ok: true; value: T } | { ok: false; errors: Record<string, string> };
