// Pont sécurisé entre l'interface et le processus principal (contextIsolation + sandbox).
// Seules les fonctions ci-dessous sont accessibles depuis la page : aucun accès direct à Node.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC, type MbiApi } from '../shared/api';

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);
const send = (channel: string, ...args: unknown[]) => ipcRenderer.send(channel, ...args);

const api: MbiApi = {
  getSnapshot: () => invoke(IPC.snapshotGet),
  onSnapshot: (cb) => subscribe(IPC.snapshotPush, cb),
  tasks: {
    create: (input) => invoke(IPC.taskCreate, input),
    update: (id, patch) => invoke(IPC.taskUpdate, id, patch),
    remove: (id) => invoke(IPC.taskRemove, id),
    toggle: (id) => invoke(IPC.taskToggle, id),
    setStatus: (id, status) => invoke(IPC.taskSetStatus, id, status),
    postpone: (id, days) => invoke(IPC.taskPostpone, id, days),
    duplicate: (id) => invoke(IPC.taskDuplicate, id),
    quickAdd: (text, defaults) => invoke(IPC.taskQuickAdd, text, defaults ?? {}),
    snooze: (id, minutes) => invoke(IPC.taskSnooze, id, minutes),
    contextMenu: (id) => send(IPC.taskContextMenu, id),
  },
  projects: {
    create: (input) => invoke(IPC.projectCreate, input),
    update: (id, input) => invoke(IPC.projectUpdate, id, input),
    remove: (id) => invoke(IPC.projectRemove, id),
  },
  notes: {
    create: (input) => invoke(IPC.noteCreate, input ?? {}),
    update: (id, input) => invoke(IPC.noteUpdate, id, input),
    remove: (id) => invoke(IPC.noteRemove, id),
  },
  settings: {
    update: (patch) => invoke(IPC.settingsUpdate, patch),
  },
  widgets: {
    setVisible: (type, visible) => invoke(IPC.widgetSetVisible, type, visible),
    setAlwaysOnTop: (type, value) => invoke(IPC.widgetSetOnTop, type, value),
    showAll: () => invoke(IPC.widgetShowAll),
    hideAll: () => invoke(IPC.widgetHideAll),
    resetLayout: () => invoke(IPC.widgetReset),
    menu: () => send(IPC.widgetMenu),
    hideSelf: () => send(IPC.widgetHideSelf),
    resizeStart: (edge) => send(IPC.widgetResizeStart, edge),
    resizeMove: () => send(IPC.widgetResizeMove),
    resizeEnd: () => send(IPC.widgetResizeEnd),
  },
  reminders: {
    getPending: () => invoke(IPC.remindersGet),
    onPending: (cb) => subscribe(IPC.remindersPush, cb),
    dismiss: (taskId, reminderId) => send(IPC.reminderDismiss, taskId, reminderId),
    dismissAll: () => send(IPC.reminderDismissAll),
    setPopupHeight: (height) => send(IPC.reminderPopupHeight, height),
  },
  app: {
    openDashboard: (route) => send(IPC.appOpenDashboard, route ?? null),
    openQuickAdd: () => send(IPC.appOpenQuickAdd),
    closeWindow: () => send(IPC.appCloseWindow),
    onNavigate: (cb) => subscribe(IPC.appNavigate, cb),
    onQuickAddShown: (cb) => subscribe(IPC.appQuickAddShown, cb),
    confirm: (message, detail) => invoke(IPC.appConfirm, message, detail ?? ''),
    exportData: () => invoke(IPC.appExport),
    importData: (mode) => invoke(IPC.appImport, mode),
    listBackups: () => invoke(IPC.appListBackups),
    backupNow: () => invoke(IPC.appBackupNow),
    restoreBackup: (file) => invoke(IPC.appRestoreBackup, file),
    openDataFolder: () => send(IPC.appOpenDataFolder),
    reportError: (message) => send(IPC.appReportError, String(message).slice(0, 4000)),
    reenableNative: () => send(IPC.appReenableNative),
    quit: () => send(IPC.appQuit),
  },
};

contextBridge.exposeInMainWorld('mbi', api);
