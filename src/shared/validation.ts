// Validation des données saisies. Toutes les entrées venant de l'interface (IPC) passent par ici
// avant d'atteindre le stockage. Les messages d'erreur sont rédigés pour l'utilisateur.

import { LIMITS } from './defaults';
import { isValidDateKey, isValidLocalDateTime, isValidTimeKey } from './dates';
import {
  PRIORITIES,
  STATUSES,
  type FontScale,
  type NoteInput,
  type Priority,
  type ProjectInput,
  type ReminderInput,
  type Result,
  type Settings,
  type ShortcutSettings,
  type TaskStatus,
  type ThemeMode,
} from './types';

export interface NormalizedTaskInput {
  title: string;
  description: string;
  dueDate: string | null;
  dueTime: string | null;
  priority: Priority;
  projectId: string | null;
  status: TaskStatus;
  reminders: ReminderInput[];
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_RE.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Supprime les caractères de contrôle (hors retours à la ligne et tabulations). */
export function sanitizeText(value: string, multiline: boolean): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(multiline ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, multiline ? '' : ' ');
  return multiline ? cleaned.replace(/\r\n?/g, '\n') : cleaned.replace(/\s+/g, ' ').trim();
}

export function validateReminders(raw: unknown, hasDueDate: boolean): Result<ReminderInput[]> {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, errors: { reminders: 'Format de rappels invalide.' } };
  if (raw.length > LIMITS.remindersMax) {
    return { ok: false, errors: { reminders: `${LIMITS.remindersMax} rappels maximum par tâche.` } };
  }
  const out: ReminderInput[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isRecord(item)) return { ok: false, errors: { reminders: 'Rappel invalide.' } };
    const firedAt = typeof item.firedAt === 'string' && !Number.isNaN(Date.parse(item.firedAt)) ? item.firedAt : null;
    const id = typeof item.id === 'string' && item.id.length <= 64 ? item.id : undefined;
    const snooze = item.snooze === true;
    if (item.type === 'relative') {
      const offset = item.offsetMinutes;
      if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0 || offset > LIMITS.reminderOffsetMax) {
        return { ok: false, errors: { reminders: 'Le délai du rappel doit être compris entre 0 minute et 4 semaines.' } };
      }
      if (!hasDueDate) {
        return { ok: false, errors: { reminders: "Un rappel avant l'échéance nécessite une date d'échéance." } };
      }
      const key = `r:${offset}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ id, type: 'relative', offsetMinutes: offset, firedAt, snooze });
    } else if (item.type === 'absolute') {
      if (!isValidLocalDateTime(item.at)) {
        return { ok: false, errors: { reminders: 'La date du rappel est invalide.' } };
      }
      const key = `a:${item.at}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ id, type: 'absolute', at: item.at, firedAt, snooze });
    } else {
      return { ok: false, errors: { reminders: 'Type de rappel inconnu.' } };
    }
  }
  return { ok: true, value: out };
}

/** Valide une tâche complète (création, ou fusion « existant + modifications »). */
export function validateTaskInput(raw: unknown): Result<NormalizedTaskInput> {
  if (!isRecord(raw)) return { ok: false, errors: { form: 'Données de tâche invalides.' } };
  const errors: Record<string, string> = {};

  const title = typeof raw.title === 'string' ? sanitizeText(raw.title, false) : '';
  if (!title) errors.title = 'Le titre est obligatoire.';
  else if (title.length > LIMITS.titleMax) errors.title = `Le titre ne doit pas dépasser ${LIMITS.titleMax} caractères.`;

  let description = '';
  if (raw.description !== undefined && raw.description !== null) {
    if (typeof raw.description !== 'string') errors.description = 'Description invalide.';
    else {
      description = sanitizeText(raw.description, true).trimEnd();
      if (description.length > LIMITS.descriptionMax) {
        errors.description = `La description ne doit pas dépasser ${LIMITS.descriptionMax} caractères.`;
      }
    }
  }

  let dueDate: string | null = null;
  if (raw.dueDate !== undefined && raw.dueDate !== null && raw.dueDate !== '') {
    if (isValidDateKey(raw.dueDate)) dueDate = raw.dueDate;
    else errors.dueDate = "La date d'échéance est invalide.";
  }

  let dueTime: string | null = null;
  if (raw.dueTime !== undefined && raw.dueTime !== null && raw.dueTime !== '') {
    if (!isValidTimeKey(raw.dueTime)) errors.dueTime = "L'heure est invalide (format HH:MM).";
    else if (!dueDate && !errors.dueDate) errors.dueTime = "Une heure nécessite une date d'échéance.";
    else dueTime = raw.dueTime;
  }

  let priority: Priority = 'normal';
  if (raw.priority !== undefined) {
    if ((PRIORITIES as readonly unknown[]).includes(raw.priority)) priority = raw.priority as Priority;
    else errors.priority = 'Priorité inconnue.';
  }

  let status: TaskStatus = 'todo';
  if (raw.status !== undefined) {
    if ((STATUSES as readonly unknown[]).includes(raw.status)) status = raw.status as TaskStatus;
    else errors.status = 'Statut inconnu.';
  }

  let projectId: string | null = null;
  if (raw.projectId !== undefined && raw.projectId !== null && raw.projectId !== '') {
    if (typeof raw.projectId === 'string' && raw.projectId.length <= 64) projectId = raw.projectId;
    else errors.projectId = 'Projet invalide.';
  }

  const reminders = validateReminders(raw.reminders, dueDate !== null);
  if (!reminders.ok) Object.assign(errors, reminders.errors);

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      title,
      description,
      dueDate,
      dueTime,
      priority,
      projectId,
      status,
      reminders: reminders.ok ? reminders.value : [],
    },
  };
}

export function validateProjectInput(raw: unknown): Result<Required<ProjectInput>> {
  if (!isRecord(raw)) return { ok: false, errors: { form: 'Données de projet invalides.' } };
  const errors: Record<string, string> = {};
  const name = typeof raw.name === 'string' ? sanitizeText(raw.name, false) : '';
  if (!name) errors.name = 'Le nom du projet est obligatoire.';
  else if (name.length > LIMITS.projectNameMax) errors.name = `Le nom ne doit pas dépasser ${LIMITS.projectNameMax} caractères.`;
  let color = '#6366f1';
  if (raw.color !== undefined) {
    if (isHexColor(raw.color)) color = raw.color.toLowerCase();
    else errors.color = 'Couleur invalide.';
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { name, color } };
}

export function validateNoteInput(raw: unknown): Result<NoteInput> {
  if (!isRecord(raw)) return { ok: false, errors: { form: 'Données de note invalides.' } };
  const errors: Record<string, string> = {};
  const value: NoteInput = {};
  if (raw.title !== undefined) {
    if (typeof raw.title !== 'string') errors.title = 'Titre invalide.';
    else {
      value.title = sanitizeText(raw.title, false);
      if (value.title.length > LIMITS.noteTitleMax) errors.title = `Le titre ne doit pas dépasser ${LIMITS.noteTitleMax} caractères.`;
    }
  }
  if (raw.content !== undefined) {
    if (typeof raw.content !== 'string') errors.content = 'Contenu invalide.';
    else {
      value.content = sanitizeText(raw.content, true);
      if (value.content.length > LIMITS.noteContentMax) errors.content = 'La note est trop longue.';
    }
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value };
}

const MODIFIERS = new Set([
  'Command',
  'Cmd',
  'Control',
  'Ctrl',
  'CommandOrControl',
  'CmdOrCtrl',
  'Alt',
  'Option',
  'AltGr',
  'Shift',
  'Super',
  'Meta',
]);
const KEY_RE =
  /^(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4])|Plus|Space|Tab|Backspace|Delete|Insert|Return|Enter|Up|Down|Left|Right|Home|End|PageUp|PageDown|Escape|Esc|num[0-9]|[)!@#$%^&*(:;+=<,_\-.>?/~`{}|\\[\]"'])$/;

/** Vérifie une combinaison de touches au format Electron (ex. « CommandOrControl+Alt+N »). */
export function isValidAccelerator(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 60) return false;
  const parts = value.split('+');
  if (parts.length < 2) return false;
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  if (!mods.every((m) => MODIFIERS.has(m))) return false;
  if (new Set(mods).size !== mods.length) return false;
  return KEY_RE.test(key);
}

type Validator = (v: unknown) => boolean;
const bool: Validator = (v) => typeof v === 'boolean';
const time: Validator = (v) => isValidTimeKey(v);

const SETTINGS_VALIDATORS: { [K in keyof Settings]: Validator } = {
  theme: (v) => (['system', 'light', 'dark'] as ThemeMode[]).includes(v as ThemeMode),
  accentColor: isHexColor,
  widgetOpacity: (v) => typeof v === 'number' && v >= 0.4 && v <= 1,
  fontScale: (v) => (['compact', 'normal', 'large'] as FontScale[]).includes(v as FontScale),
  animations: bool,
  launchAtStartup: bool,
  showDashboardOnStart: bool,
  closeToTray: bool,
  nativeNotifications: bool,
  reminderPopup: bool,
  reminderSound: bool,
  dailyDigest: bool,
  dailyDigestTime: time,
  defaultReminderTime: time,
  defaultReminderOffset: (v) =>
    v === null || (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= LIMITS.reminderOffsetMax),
  snoozeMinutes: (v) => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 1440,
  desktopAnchor: bool,
  discreetMode: bool,
  fadeInactiveWidgets: bool,
  lockWidgets: bool,
  snapWidgets: bool,
  upcomingDays: (v) => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 60,
  showCompletedInWidgets: bool,
  confirmDelete: bool,
  shortcuts: (v) => {
    if (!isRecord(v)) return false;
    const keys: (keyof ShortcutSettings)[] = ['quickAdd', 'toggleWidgets', 'openDashboard'];
    return keys.every((k) => v[k] === '' || isValidAccelerator(v[k])) && Object.keys(v).every((k) => keys.includes(k as keyof ShortcutSettings));
  },
};

const SETTINGS_ERRORS: Partial<Record<keyof Settings, string>> = {
  accentColor: 'Couleur invalide (format #RRVVBB).',
  shortcuts: 'Raccourci clavier invalide : utilisez au moins une touche de modification (Ctrl, Alt, Maj) et une touche.',
  dailyDigestTime: 'Heure invalide.',
  defaultReminderTime: 'Heure invalide.',
  upcomingDays: 'Le nombre de jours doit être compris entre 1 et 60.',
};

/** Valide une mise à jour partielle des paramètres. Les clés inconnues sont refusées. */
export function validateSettingsPatch(raw: unknown): Result<Partial<Settings>> {
  if (!isRecord(raw)) return { ok: false, errors: { form: 'Paramètres invalides.' } };
  const errors: Record<string, string> = {};
  const value: Partial<Settings> = {};
  for (const [key, v] of Object.entries(raw)) {
    const validator = SETTINGS_VALIDATORS[key as keyof Settings];
    if (!validator) {
      errors[key] = 'Paramètre inconnu.';
      continue;
    }
    if (!validator(v)) {
      errors[key] = SETTINGS_ERRORS[key as keyof Settings] ?? 'Valeur invalide.';
      continue;
    }
    (value as Record<string, unknown>)[key] = key === 'accentColor' ? (v as string).toLowerCase() : v;
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value };
}

/** Fusionne des paramètres stockés (potentiellement anciens ou corrompus) avec les valeurs par défaut. */
export function sanitizeStoredSettings(stored: Record<string, unknown>, defaults: Settings): Settings {
  const out: Settings = { ...defaults, shortcuts: { ...defaults.shortcuts } };
  for (const key of Object.keys(defaults) as (keyof Settings)[]) {
    if (!(key in stored)) continue;
    const v = key === 'shortcuts' && isRecord(stored.shortcuts) ? { ...defaults.shortcuts, ...stored.shortcuts } : stored[key];
    if (SETTINGS_VALIDATORS[key](v)) (out as unknown as Record<string, unknown>)[key] = v;
  }
  return out;
}
