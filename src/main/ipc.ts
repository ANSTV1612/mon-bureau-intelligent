// Gestionnaires IPC. Chaque appel est vérifié (origine de la page) et protégé contre les erreurs ;
// les données sont validées par le DataService avant toute écriture.

import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { IPC, type DashboardRoute, type ResizeEdge } from '../shared/api';
import { PRIORITY_LABELS, STATUS_LABELS } from '../shared/defaults';
import { addDays, todayKey } from '../shared/dates';
import { PRIORITIES, STATUSES, WIDGET_TYPES, type AppSnapshot, type Priority, type Settings, type WidgetType } from '../shared/types';
import type { DataService } from './services/dataService';
import type { WidgetManager } from './windows/widgetManager';
import type { DashboardWindow } from './windows/dashboard';
import type { QuickAddWindow } from './windows/quickAdd';
import type { ReminderPopup } from './windows/reminderPopup';
import { isTrustedUrl } from './windows/common';
import { log } from './logger';

export interface IpcContext {
  data: DataService;
  widgets: WidgetManager;
  dashboard: DashboardWindow;
  quickAdd: QuickAddWindow;
  popup: ReminderPopup;
  snapshot: () => AppSnapshot;
  dataDir: string;
  quit: () => void;
  reenableNative: () => void;
}

const INTERNAL_ERROR = { ok: false, errors: { form: 'Une erreur inattendue est survenue. Réessayez.' } } as const;

function trusted(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? '';
  if (isTrustedUrl(url)) return true;
  log('warn', `Appel IPC refusé depuis ${url}`);
  return false;
}

function handle(channel: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!trusted(event)) throw new Error('Origine non autorisée');
    try {
      return await fn(event, ...args);
    } catch (err) {
      log('error', `Erreur IPC ${channel}`, err);
      return INTERNAL_ERROR;
    }
  });
}

function on(channel: string, fn: (event: IpcMainEvent, ...args: unknown[]) => unknown): void {
  ipcMain.on(channel, (event, ...args) => {
    if (!trusted(event)) return;
    try {
      const r = fn(event, ...args);
      if (r instanceof Promise) r.catch((err) => log('error', `Erreur IPC ${channel}`, err));
    } catch (err) {
      log('error', `Erreur IPC ${channel}`, err);
    }
  });
}

const isWidgetType = (v: unknown): v is WidgetType => (WIDGET_TYPES as readonly unknown[]).includes(v);

function sanitizeRoute(raw: unknown): DashboardRoute | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const pages = ['overview', 'tasks', 'projects', 'notes', 'widgets', 'settings'];
  if (!pages.includes(r.page as string)) return null;
  const route: DashboardRoute = { page: r.page as DashboardRoute['page'] };
  if (typeof r.editTaskId === 'string') route.editTaskId = r.editTaskId;
  if (typeof r.noteId === 'string') route.noteId = r.noteId;
  if (r.newTask && typeof r.newTask === 'object') {
    const n = r.newTask as Record<string, unknown>;
    route.newTask = {
      dueDate: typeof n.dueDate === 'string' ? n.dueDate : null,
      priority: (PRIORITIES as readonly unknown[]).includes(n.priority) ? (n.priority as Priority) : undefined,
      projectId: typeof n.projectId === 'string' ? n.projectId : null,
    };
  }
  return route;
}

export async function confirmDialog(parent: BrowserWindow | null, message: string, detail = '', okLabel = 'Confirmer'): Promise<boolean> {
  const options: Electron.MessageBoxOptions = {
    type: 'question',
    buttons: ['Annuler', okLabel],
    defaultId: 1,
    cancelId: 0,
    title: 'Mon Bureau Intelligent',
    message,
    detail,
    noLink: true,
  };
  const result = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
  return result.response === 1;
}

/** Fenêtre parente pour un dialogue : le tableau de bord, sinon aucune (widgets trop petits). */
function dialogParent(ctx: IpcContext, event: IpcMainEvent | IpcMainInvokeEvent): BrowserWindow | null {
  const win = BrowserWindow.fromWebContents(event.sender);
  return win && win === ctx.dashboard.window ? win : null;
}

export function registerIpc(ctx: IpcContext): void {
  const { data, widgets } = ctx;

  handle(IPC.snapshotGet, () => ctx.snapshot());

  // Tâches
  handle(IPC.taskCreate, (_e, input) => data.createTask(input));
  handle(IPC.taskUpdate, (_e, id, patch) => data.updateTask(id, patch));
  handle(IPC.taskRemove, (_e, id) => data.deleteTask(id));
  handle(IPC.taskToggle, (_e, id) => data.toggleTask(id));
  handle(IPC.taskSetStatus, (_e, id, status) => data.setTaskStatus(id, status));
  handle(IPC.taskPostpone, (_e, id, days) => data.postponeTask(id, days));
  handle(IPC.taskDuplicate, (_e, id) => data.duplicateTask(id));
  handle(IPC.taskQuickAdd, (_e, text, defaults) => data.quickAdd(text, defaults));
  handle(IPC.taskSnooze, (_e, id, minutes) => {
    const r = data.snoozeReminder(id, minutes);
    if (r.ok) ctx.popup.dismiss(r.value.id, null);
    return r;
  });
  on(IPC.taskContextMenu, (event, id) => {
    if (typeof id !== 'string') return;
    const task = data.getTask(id);
    if (!task) return;
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const today = todayKey();
    const projects = data.listProjects();
    const menu = Menu.buildFromTemplate([
      {
        label: task.status === 'done' ? 'Marquer comme à faire' : 'Marquer comme terminée',
        click: () => data.toggleTask(id),
      },
      {
        label: 'Statut',
        submenu: STATUSES.map((s) => ({
          label: STATUS_LABELS[s],
          type: 'radio' as const,
          checked: task.status === s,
          click: () => data.setTaskStatus(id, s),
        })),
      },
      {
        label: 'Priorité',
        submenu: [...PRIORITIES].reverse().map((p) => ({
          label: PRIORITY_LABELS[p],
          type: 'radio' as const,
          checked: task.priority === p,
          click: () => data.updateTask(id, { priority: p }),
        })),
      },
      {
        label: 'Échéance',
        submenu: [
          { label: "Aujourd'hui", click: () => data.updateTask(id, { dueDate: today }) },
          { label: 'Demain', click: () => data.updateTask(id, { dueDate: addDays(today, 1) }) },
          { label: 'Dans une semaine', click: () => data.updateTask(id, { dueDate: addDays(today, 7) }) },
          { label: "Reporter d'un jour", click: () => data.postponeTask(id, 1) },
          { type: 'separator' },
          { label: "Retirer l'échéance", enabled: !!task.dueDate, click: () => data.updateTask(id, { dueDate: null }) },
        ],
      },
      {
        label: 'Projet',
        submenu: [
          { label: 'Sans projet', type: 'radio', checked: !task.projectId, click: () => data.updateTask(id, { projectId: null }) },
          ...(projects.length ? [{ type: 'separator' as const }] : []),
          ...projects.map((p) => ({
            label: p.name,
            type: 'radio' as const,
            checked: task.projectId === p.id,
            click: () => data.updateTask(id, { projectId: p.id }),
          })),
        ],
      },
      { type: 'separator' },
      { label: 'Modifier…', click: () => ctx.dashboard.open({ page: 'tasks', editTaskId: id }) },
      { label: 'Dupliquer', click: () => data.duplicateTask(id) },
      { type: 'separator' },
      {
        label: 'Supprimer',
        click: async () => {
          if (data.getSettings().confirmDelete) {
            const okDelete = await confirmDialog(null, `Supprimer la tâche « ${task.title} » ?`, 'Cette action est définitive.', 'Supprimer');
            if (!okDelete) return;
          }
          data.deleteTask(id);
        },
      },
    ]);
    menu.popup({ window: win });
  });

  // Projets & notes
  handle(IPC.projectCreate, (_e, input) => data.createProject(input));
  handle(IPC.projectUpdate, (_e, id, input) => data.updateProject(id, input));
  handle(IPC.projectRemove, (_e, id) => data.deleteProject(id));
  handle(IPC.noteCreate, (_e, input) => data.createNote(input));
  handle(IPC.noteUpdate, (_e, id, input) => data.updateNote(id, input));
  handle(IPC.noteRemove, (_e, id) => data.deleteNote(id));

  // Paramètres
  handle(IPC.settingsUpdate, (_e, patch) => data.updateSettings(patch));

  // Widgets
  handle(IPC.widgetSetVisible, (_e, type, visible) => {
    if (isWidgetType(type) && typeof visible === 'boolean') widgets.setVisible(type, visible);
  });
  handle(IPC.widgetSetOnTop, (_e, type, value) => {
    if (isWidgetType(type) && typeof value === 'boolean') widgets.setAlwaysOnTop(type, value);
  });
  handle(IPC.widgetShowAll, () => widgets.showAll());
  handle(IPC.widgetHideAll, () => widgets.hideAll());
  handle(IPC.widgetReset, () => widgets.resetLayout());
  on(IPC.widgetHideSelf, (event) => {
    const type = widgets.typeOf(event.sender);
    if (type) widgets.setVisible(type, false);
  });
  on(IPC.widgetResizeStart, (event, edge) => widgets.resizeStart(event.sender, edge as ResizeEdge));
  on(IPC.widgetResizeMove, (event) => widgets.resizeMove(event.sender));
  on(IPC.widgetResizeEnd, (event) => widgets.resizeEnd(event.sender));
  on(IPC.widgetMenu, (event) => {
    const type = widgets.typeOf(event.sender);
    if (!type) return;
    const state = widgets.list().find((w) => w.type === type)!;
    const settings = data.getSettings();
    const setSetting = (patch: Partial<Settings>) => data.updateSettings(patch);
    Menu.buildFromTemplate([
      {
        label: 'Toujours au premier plan',
        type: 'checkbox',
        checked: state.alwaysOnTop,
        click: (item) => widgets.setAlwaysOnTop(type, item.checked),
      },
      {
        label: 'Verrouiller la disposition',
        type: 'checkbox',
        checked: settings.lockWidgets,
        click: (item) => setSetting({ lockWidgets: item.checked }),
      },
      {
        label: 'Opacité des widgets',
        submenu: [1, 0.92, 0.85, 0.75, 0.6, 0.45].map((v) => ({
          label: `${Math.round(v * 100)} %`,
          type: 'radio' as const,
          checked: Math.abs(settings.widgetOpacity - v) < 0.035,
          click: () => setSetting({ widgetOpacity: v }),
        })),
      },
      { type: 'separator' },
      { label: 'Nouvelle tâche…', click: () => ctx.quickAdd.show() },
      { label: 'Ouvrir le tableau de bord', click: () => ctx.dashboard.open({ page: 'overview' }) },
      { label: 'Gérer les widgets…', click: () => ctx.dashboard.open({ page: 'widgets' }) },
      { type: 'separator' },
      { label: 'Masquer ce widget', click: () => widgets.setVisible(type, false) },
    ]).popup({ window: BrowserWindow.fromWebContents(event.sender) ?? undefined });
  });

  // Rappels
  handle(IPC.remindersGet, () => ctx.popup.items);
  on(IPC.reminderDismiss, (_e, taskId, reminderId) => {
    if (typeof taskId === 'string') ctx.popup.dismiss(taskId, typeof reminderId === 'string' ? reminderId : null);
  });
  on(IPC.reminderDismissAll, () => ctx.popup.dismissAll());
  on(IPC.reminderPopupHeight, (_e, height) => {
    if (typeof height === 'number') ctx.popup.setHeight(height);
  });

  // Application
  on(IPC.appOpenDashboard, (_e, route) => ctx.dashboard.open(sanitizeRoute(route)));
  on(IPC.appOpenQuickAdd, () => ctx.quickAdd.show());
  on(IPC.appCloseWindow, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (ctx.quickAdd.owns(win)) ctx.quickAdd.hide();
    else if (ctx.popup.owns(win)) ctx.popup.dismissAll();
  });
  handle(IPC.appConfirm, (event, message, detail) =>
    confirmDialog(dialogParent(ctx, event), String(message).slice(0, 300), String(detail ?? '').slice(0, 1000)),
  );
  handle(IPC.appExport, async (event) => {
    const d = new Date();
    const name = `mon-bureau-export-${todayKey(d)}.json`;
    const parent = dialogParent(ctx, event);
    const options: Electron.SaveDialogOptions = {
      title: 'Exporter mes données',
      defaultPath: path.join(app.getPath('documents'), name),
      filters: [{ name: 'Exportation Mon Bureau Intelligent', extensions: ['json'] }],
    };
    const result = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { ok: true, value: null };
    fs.writeFileSync(result.filePath, JSON.stringify(data.exportData(), null, 2), 'utf8');
    return { ok: true, value: result.filePath };
  });
  handle(IPC.appImport, async (event, mode) => {
    const importMode = mode === 'merge' ? 'merge' : 'replace';
    const parent = dialogParent(ctx, event);
    const options: Electron.OpenDialogOptions = {
      title: 'Importer des données',
      properties: ['openFile'],
      filters: [{ name: 'Exportation Mon Bureau Intelligent', extensions: ['json'] }],
    };
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return { ok: true, value: null };
    const file = result.filePaths[0];
    if (fs.statSync(file).size > 50 * 1024 * 1024) return { ok: false, errors: { form: 'Fichier trop volumineux.' } };
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return { ok: false, errors: { form: "Le fichier n'est pas un JSON valide." } };
    }
    if (importMode === 'replace') {
      const confirmed = await confirmDialog(
        parent,
        'Remplacer toutes vos données ?',
        'Les tâches, projets et notes actuels seront remplacés par ceux du fichier. Une sauvegarde automatique est créée avant l’import.',
        'Remplacer',
      );
      if (!confirmed) return { ok: true, value: null };
    }
    return data.importData(parsed, importMode);
  });
  handle(IPC.appListBackups, () => data.listBackups());
  handle(IPC.appBackupNow, () => ({ ok: true, value: data.backup('manuelle') }));
  handle(IPC.appRestoreBackup, async (event, file) => {
    const confirmed = await confirmDialog(
      dialogParent(ctx, event),
      'Restaurer cette sauvegarde ?',
      'Vos données actuelles seront remplacées (une sauvegarde de sécurité est créée au préalable).',
      'Restaurer',
    );
    if (!confirmed) return { ok: false, errors: { form: 'Restauration annulée.' } };
    return data.restoreBackup(file);
  });
  on(IPC.appOpenDataFolder, () => void shell.openPath(ctx.dataDir));
  on(IPC.appReportError, (event, message) => {
    log('error', `Erreur interface (${event.senderFrame?.url.split('#')[1] ?? '?'})`, String(message));
  });
  on(IPC.appQuit, () => ctx.quit());
  on(IPC.appReenableNative, () => ctx.reenableNative());
}
