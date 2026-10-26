import type { Priority, Settings, TaskStatus, WidgetType } from './types';

export const APP_NAME = 'Mon Bureau Intelligent';

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  accentColor: '#6366f1',
  widgetOpacity: 0.86,
  fontScale: 'normal',
  animations: true,
  launchAtStartup: true,
  showDashboardOnStart: true,
  closeToTray: true,
  nativeNotifications: true,
  reminderPopup: true,
  reminderSound: true,
  dailyDigest: true,
  dailyDigestTime: '09:00',
  defaultReminderTime: '09:00',
  defaultReminderOffset: 15,
  snoozeMinutes: 10,
  desktopAnchor: true,
  discreetMode: true,
  fadeInactiveWidgets: false,
  lockWidgets: false,
  snapWidgets: true,
  upcomingDays: 7,
  showCompletedInWidgets: true,
  confirmDelete: true,
  shortcuts: {
    quickAdd: 'CommandOrControl+Alt+N',
    toggleWidgets: 'CommandOrControl+Alt+W',
    openDashboard: 'CommandOrControl+Alt+B',
  },
};

export interface WidgetMeta {
  type: WidgetType;
  label: string;
  description: string;
  icon: string;
  defaultWidth: number;
  defaultHeight: number;
  minWidth: number;
  minHeight: number;
  /** Visible au premier lancement. */
  defaultVisible: boolean;
}

export const WIDGET_META: Record<WidgetType, WidgetMeta> = {
  today: {
    type: 'today',
    label: "Aujourd'hui",
    description: 'Les tâches prévues pour la journée et celles en retard.',
    icon: 'sun',
    defaultWidth: 320,
    defaultHeight: 360,
    minWidth: 240,
    minHeight: 160,
    defaultVisible: true,
  },
  priorities: {
    type: 'priorities',
    label: 'Priorités',
    description: 'Les tâches urgentes et importantes.',
    icon: 'flag',
    defaultWidth: 320,
    defaultHeight: 280,
    minWidth: 240,
    minHeight: 160,
    defaultVisible: true,
  },
  upcoming: {
    type: 'upcoming',
    label: 'À venir',
    description: 'Les tâches des prochains jours, regroupées par date.',
    icon: 'calendar',
    defaultWidth: 320,
    defaultHeight: 340,
    minWidth: 240,
    minHeight: 160,
    defaultVisible: false,
  },
  tasks: {
    type: 'tasks',
    label: 'Mes tâches',
    description: 'Toutes vos tâches, avec recherche et filtre rapide.',
    icon: 'list',
    defaultWidth: 340,
    defaultHeight: 420,
    minWidth: 260,
    minHeight: 180,
    defaultVisible: false,
  },
  projects: {
    type: 'projects',
    label: 'Projets',
    description: 'Les tâches regroupées par projet ou catégorie.',
    icon: 'folder',
    defaultWidth: 320,
    defaultHeight: 360,
    minWidth: 240,
    minHeight: 160,
    defaultVisible: false,
  },
  notes: {
    type: 'notes',
    label: 'Notes rapides',
    description: 'Un bloc-notes toujours sous la main, enregistré automatiquement.',
    icon: 'note',
    defaultWidth: 300,
    defaultHeight: 260,
    minWidth: 220,
    minHeight: 150,
    defaultVisible: true,
  },
  reminders: {
    type: 'reminders',
    label: 'Rappels',
    description: 'Les prochains rappels et les échéances dépassées.',
    icon: 'bell',
    defaultWidth: 300,
    defaultHeight: 260,
    minWidth: 220,
    minHeight: 150,
    defaultVisible: false,
  },
  progress: {
    type: 'progress',
    label: 'Progression',
    description: 'Statistiques des tâches terminées et restantes.',
    icon: 'chart',
    defaultWidth: 300,
    defaultHeight: 250,
    minWidth: 220,
    minHeight: 170,
    defaultVisible: true,
  },
};

/** Ordre d'affichage dans les menus. */
export const WIDGET_ORDER: WidgetType[] = [
  'tasks',
  'today',
  'upcoming',
  'priorities',
  'projects',
  'notes',
  'reminders',
  'progress',
];

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: 'Faible',
  normal: 'Normale',
  high: 'Élevée',
  urgent: 'Urgente',
};

export const PRIORITY_RANK: Record<Priority, number> = { low: 0, normal: 1, high: 2, urgent: 3 };

export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'À faire',
  in_progress: 'En cours',
  done: 'Terminée',
};

export const PROJECT_COLORS = [
  '#6366f1',
  '#0ea5e9',
  '#14b8a6',
  '#22c55e',
  '#eab308',
  '#f97316',
  '#ef4444',
  '#ec4899',
  '#a855f7',
  '#64748b',
];

export const ACCENT_PRESETS = [
  { name: 'Indigo', value: '#6366f1' },
  { name: 'Bleu', value: '#2563eb' },
  { name: 'Ciel', value: '#0ea5e9' },
  { name: 'Turquoise', value: '#0d9488' },
  { name: 'Vert', value: '#16a34a' },
  { name: 'Ambre', value: '#d97706' },
  { name: 'Corail', value: '#f43f5e' },
  { name: 'Violet', value: '#9333ea' },
];

/** Décalages proposés pour les rappels (minutes avant l'échéance). */
export const REMINDER_PRESETS = [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080];

export const LIMITS = {
  titleMax: 200,
  descriptionMax: 5000,
  projectNameMax: 60,
  noteTitleMax: 100,
  noteContentMax: 100_000,
  remindersMax: 10,
  reminderOffsetMax: 40320, // 4 semaines
  projectsMax: 200,
  notesMax: 200,
};
