// Point d'entrée du processus principal d'Electron.

import { app, BrowserWindow, dialog, nativeTheme, powerMonitor } from 'electron';
import path from 'node:path';
import { openDatabase } from './storage/database';
import { DataService, type ChangeKind } from './services/dataService';
import { ReminderScheduler } from './services/reminderScheduler';
import { createDesktopIntegration, resetDesktopGuard, type DesktopIntegration } from './platform/desktop';
import { WidgetManager } from './windows/widgetManager';
import { DashboardWindow } from './windows/dashboard';
import { QuickAddWindow } from './windows/quickAdd';
import { ReminderPopup } from './windows/reminderPopup';
import { safeSend, setAppPaths } from './windows/common';
import { AppTray } from './tray';
import { registerIpc } from './ipc';
import { applyAutoStart, autoStartSupported, notify, registerShortcuts } from './system';
import { initLogger, log } from './logger';
import { startWatchdog, type Watchdog } from './watchdog';
import { IPC } from '../shared/api';
import { PRIORITY_LABELS } from '../shared/defaults';
import { todayKey } from '../shared/dates';
import { isOverdue } from '../shared/queries';
import type { AppSnapshot, FiredReminder, Settings, ShortcutStatus } from '../shared/types';

export const APP_ID = 'fr.monbureau.intelligent';

// Dossier de données personnalisé (tests automatisés uniquement).
if (process.env.MBI_USER_DATA_DIR) app.setPath('userData', process.env.MBI_USER_DATA_DIR);
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
if (process.platform === 'linux') app.commandLine.appendSwitch('enable-transparent-visuals');
// Interface en français quel que soit le système (format des dates et heures des champs de saisie).
app.commandLine.appendSwitch('lang', 'fr-FR');

const startHidden = process.argv.includes('--hidden');
/** Relance effectuée par le chien de garde : pas de nouvelle surveillance (évite toute boucle). */
const SAFETY_RELAUNCH = '--relance-securite';

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (!argv.includes('--hidden')) controller?.dashboard.open();
  });
  app.whenReady().then(() => {
    try {
      controller = new AppController();
      controller.start();
    } catch (err) {
      log('error', 'Démarrage impossible', err);
      dialog.showErrorBox(
        'Mon Bureau Intelligent',
        `L'application n'a pas pu démarrer.\n\n${err instanceof Error ? err.message : String(err)}`,
      );
      app.exit(1);
    }
  });
}

let controller: AppController | null = null;
let errorDialogShown = false;

process.on('uncaughtException', (err) => {
  log('error', 'Exception non interceptée', err);
  if (!errorDialogShown && app.isReady()) {
    errorDialogShown = true;
    dialog.showMessageBox({
      type: 'warning',
      title: 'Mon Bureau Intelligent',
      message: 'Une erreur inattendue est survenue.',
      detail: "L'application continue de fonctionner. Le détail a été enregistré dans le journal.",
    });
  }
});
process.on('unhandledRejection', (reason) => log('error', 'Promesse rejetée non gérée', reason));

class AppController {
  readonly data: DataService;
  readonly widgets: WidgetManager;
  readonly dashboard: DashboardWindow;
  readonly quickAdd = new QuickAddWindow();
  readonly popup = new ReminderPopup();
  private readonly scheduler: ReminderScheduler;
  private readonly tray: AppTray;
  private readonly desktop: DesktopIntegration;
  private watchdog: Watchdog | null = null;
  private readonly dataDir: string;
  private readonly storageWarning: string | null;
  private shortcutStatus: ShortcutStatus = { quickAdd: false, toggleWidgets: false, openDashboard: false };
  private settings: Settings;
  private revision = 0;
  private broadcastTimer: NodeJS.Timeout | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private quitting = false;
  private closed = false;

  constructor() {
    const userData = app.getPath('userData');
    initLogger(path.join(userData, 'journaux'));
    log('info', `Démarrage v${app.getVersion()} (${process.platform}, Electron ${process.versions.electron})`);

    setAppPaths({
      preload: path.join(__dirname, '../preload/index.cjs'),
      rendererIndex: path.join(__dirname, '../renderer/index.html'),
      devServerUrl: process.env.MBI_DEV_SERVER_URL || null,
      resources: app.isPackaged ? path.join(process.resourcesPath, 'assets') : path.join(app.getAppPath(), 'resources'),
    });

    this.desktop = createDesktopIntegration(userData);
    if (process.argv.includes(SAFETY_RELAUNCH)) log('warn', 'Relance automatique après un blocage au démarrage');
    else if (this.desktop.supported) {
      // Premiers appels natifs : si le processus principal se figeait, il serait relancé
      // automatiquement (et l'intégration Win32 désactivée par le garde-fou).
      this.watchdog = startWatchdog({
        pid: process.pid,
        exe: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath,
        args: [...process.argv.slice(1), SAFETY_RELAUNCH],
        timeoutMs: 15_000,
        lifetimeMs: 120_000,
        logFile: path.join(userData, 'journaux', 'chien-de-garde.log'),
      });
    }
    this.dataDir = path.join(userData, 'donnees');
    const { db, warning } = openDatabase(path.join(this.dataDir, 'mon-bureau.db'), path.join(this.dataDir, 'sauvegardes'), log);
    this.storageWarning = warning;
    this.data = new DataService(db, { backupDir: path.join(this.dataDir, 'sauvegardes'), log });
    this.settings = this.data.getSettings();
    nativeTheme.themeSource = this.settings.theme;

    this.widgets = new WidgetManager(this.data, this.desktop, () => this.updateTray());
    this.dashboard = new DashboardWindow(
      this.data,
      () => this.onDashboardHidden(),
      () => this.quit(),
    );
    this.scheduler = new ReminderScheduler(this.data, {
      onFired: (items) => this.onRemindersFired(items),
      onDigest: (s) =>
        this.settings.nativeNotifications &&
        notify({
          title: 'Votre journée',
          body:
            `${s.dueToday} tâche${s.dueToday > 1 ? 's' : ''} aujourd'hui` +
            (s.overdue ? `, ${s.overdue} en retard` : '') +
            (s.titles.length ? `\n${s.titles.map((t) => `• ${t}`).join('\n')}` : ''),
          silent: true,
          onClick: () => this.dashboard.open({ page: 'overview' }),
        }),
    });
    this.tray = new AppTray({
      openDashboard: (page) => this.dashboard.open(page ? { page } : null),
      quickAdd: () => this.quickAdd.show(),
      toggleWidget: (type, visible) => this.widgets.setVisible(type, visible),
      showAll: () => this.widgets.showAll(),
      hideAll: () => this.widgets.hideAll(),
      resetLayout: () => this.widgets.resetLayout(),
      updateSettings: (patch) => this.data.updateSettings(patch),
      quit: () => this.quit(),
    });
  }

  start(): void {
    registerIpc({
      data: this.data,
      widgets: this.widgets,
      dashboard: this.dashboard,
      quickAdd: this.quickAdd,
      popup: this.popup,
      snapshot: () => this.snapshot(),
      dataDir: this.dataDir,
      quit: () => this.quit(),
      reenableNative: () => {
        resetDesktopGuard(app.getPath('userData'));
        this.shutdown();
        app.relaunch();
        app.exit(0);
      },
    });

    this.data.on('changed', (kind: ChangeKind) => this.onDataChanged(kind));
    nativeTheme.on('updated', () => this.dashboard.updateTheme());

    try {
      this.data.dailyBackupIfNeeded();
    } catch (err) {
      log('error', 'Sauvegarde quotidienne impossible', err);
    }
    setInterval(() => {
      try {
        this.data.dailyBackupIfNeeded();
      } catch (err) {
        log('error', 'Sauvegarde quotidienne impossible', err);
      }
    }, 3 * 3_600_000);

    const firstRun = !this.data.getMeta<boolean>('initialized');
    if (firstRun) this.data.setMeta('initialized', true);
    if (firstRun || this.settings.launchAtStartup) applyAutoStart(this.settings.launchAtStartup);

    this.tray.create();
    this.registerShortcuts();
    this.widgets.init();
    this.updateTray();
    this.scheduler.start();

    if (firstRun || (!startHidden && this.settings.showDashboardOnStart)) this.dashboard.open({ page: 'overview' });
    setTimeout(() => this.quickAdd.prepare(), 1500);

    powerMonitor.on('resume', () => this.onWake());
    powerMonitor.on('unlock-screen', () => this.onWake());

    app.on('browser-window-created', (_e, win) => {
      // Fermeture de session Windows : on enregistre tout proprement.
      win.on('session-end', () => this.shutdown());
    });
    app.on('before-quit', () => this.shutdown());
    app.on('window-all-closed', () => {
      /* L'application reste active dans la zone de notification. */
    });

    if (this.storageWarning) {
      dialog.showMessageBox({ type: 'warning', title: 'Mon Bureau Intelligent', message: 'Récupération des données', detail: this.storageWarning });
    }
  }

  // ------------------------------------------------------------------ État partagé

  snapshot(): AppSnapshot {
    return {
      tasks: this.data.listTasks(),
      projects: this.data.listProjects(),
      notes: this.data.listNotes(),
      settings: this.data.getSettings(),
      widgets: this.widgets.list(),
      info: {
        version: app.getVersion(),
        platform: process.platform,
        dataPath: this.dataDir,
        isPortable: !!process.env.PORTABLE_EXECUTABLE_FILE,
        nativeDesktopSupport: this.desktop.supported,
        nativeDisabledReason: this.desktop.disabledReason,
        autoStartSupported: autoStartSupported(),
        shortcutStatus: this.shortcutStatus,
        storageWarning: this.storageWarning,
      },
      revision: this.revision,
    };
  }

  private scheduleBroadcast(): void {
    if (this.broadcastTimer) return;
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null;
      if (this.closed) return;
      try {
        this.revision += 1;
        const snap = this.snapshot();
        for (const win of BrowserWindow.getAllWindows()) safeSend(win, IPC.snapshotPush, snap);
        this.updateTray();
      } catch (err) {
        log('error', "Diffusion de l'état impossible", err);
      }
    }, 20);
  }

  private onDataChanged(kind: ChangeKind): void {
    if (kind === 'settings') this.onSettingsChanged();
    if (kind === 'tasks') {
      this.popup.sync(this.data.listTasks());
      // Une échéance ou un rappel modifié peut rendre un rappel dû immédiatement.
      if (this.tickTimer) clearTimeout(this.tickTimer);
      this.tickTimer = setTimeout(() => !this.closed && this.scheduler.tick(), 300);
    }
    this.scheduleBroadcast();
  }

  private onSettingsChanged(): void {
    const previous = this.settings;
    const next = this.data.getSettings();
    this.settings = next;
    if (previous.theme !== next.theme) nativeTheme.themeSource = next.theme;
    if (JSON.stringify(previous.shortcuts) !== JSON.stringify(next.shortcuts)) this.registerShortcuts();
    if (previous.launchAtStartup !== next.launchAtStartup) applyAutoStart(next.launchAtStartup);
    this.widgets.applySettings(previous);
  }

  private registerShortcuts(): void {
    this.shortcutStatus = registerShortcuts(this.settings.shortcuts, {
      quickAdd: () => this.quickAdd.show(),
      toggleWidgets: () => this.widgets.toggleAll(),
      openDashboard: () => this.dashboard.open(),
    });
  }

  private updateTray(): void {
    if (this.closed) return;
    const now = new Date();
    const today = todayKey(now);
    const tasks = this.data.listTasks().filter((t) => t.status !== 'done');
    this.tray.update({
      widgets: this.widgets.list(),
      allHidden: this.widgets.allHidden,
      settings: this.data.getSettings(),
      todayCount: tasks.filter((t) => t.dueDate === today).length,
      overdueCount: tasks.filter((t) => isOverdue(t, now)).length,
      autoStartSupported: autoStartSupported(),
    });
  }

  // ------------------------------------------------------------------ Rappels

  private onRemindersFired(items: FiredReminder[]): void {
    const s = this.settings;
    log('info', `${items.length} rappel(s) déclenché(s)`);
    if (s.reminderPopup) this.popup.add(items);
    if (s.nativeNotifications) {
      const silent = !s.reminderSound || s.reminderPopup; // la fenêtre de rappel joue déjà un son
      if (items.length <= 3) {
        for (const item of items) {
          const priority = item.priority === 'urgent' || item.priority === 'high' ? ` · Priorité ${PRIORITY_LABELS[item.priority].toLowerCase()}` : '';
          notify({
            title: `Rappel : ${item.title}`,
            body: `${item.dueLabel ? `Échéance : ${item.dueLabel}` : 'Rappel programmé'}${priority}`,
            silent,
            urgent: item.priority === 'urgent',
            onClick: () => this.dashboard.open({ page: 'tasks', editTaskId: item.taskId }),
          });
        }
      } else {
        notify({
          title: `${items.length} rappels`,
          body: items
            .slice(0, 4)
            .map((i) => `• ${i.title}`)
            .join('\n'),
          silent,
          onClick: () => this.dashboard.open({ page: 'overview' }),
        });
      }
    }
  }

  private onWake(): void {
    if (this.closed) return;
    this.scheduler.tick();
    this.scheduleBroadcast();
  }

  private onDashboardHidden(): void {
    if (this.data.getMeta<boolean>('closeHintShown')) return;
    this.data.setMeta('closeHintShown', true);
    notify({
      title: 'Mon Bureau Intelligent reste actif',
      body: "Vos widgets et rappels continuent de fonctionner. Retrouvez l'application dans la zone de notification.",
      silent: true,
    });
  }

  // ------------------------------------------------------------------ Arrêt

  quit(): void {
    this.shutdown();
    app.quit();
  }

  /** Arrêt propre (idempotent) : positions des widgets enregistrées, base fermée. */
  private shutdown(): void {
    if (this.quitting) return;
    this.quitting = true;
    this.watchdog?.stop();
    try {
      this.scheduler.stop();
      this.widgets.shutdown();
      this.dashboard.shutdown();
      this.quickAdd.destroy();
      this.popup.destroy();
      this.tray.destroy();
    } catch (err) {
      log('error', "Erreur pendant l'arrêt", err);
    }
    try {
      this.closed = true;
      this.data.close();
      log('info', 'Arrêt propre terminé');
    } catch (err) {
      log('error', 'Fermeture de la base impossible', err);
    }
  }
}
