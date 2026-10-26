// Intégrations système : démarrage avec Windows, raccourcis clavier globaux, notifications natives.

import { app, globalShortcut, Notification } from 'electron';
import type { ShortcutSettings, ShortcutStatus } from '../shared/types';
import path from 'node:path';
import { getAppPaths } from './windows/common';
import { log } from './logger';

export const LOGIN_ITEM_NAME = 'MonBureauIntelligent';

/** Le démarrage automatique n'est géré que pour l'application installée/portable sous Windows. */
export function autoStartSupported(): boolean {
  return app.isPackaged && process.platform === 'win32';
}

/** Chemin de l'exécutable à lancer au démarrage (version portable : l'exe d'origine, pas le dossier temporaire). */
function executablePath(): string {
  return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
}

export function applyAutoStart(enabled: boolean): void {
  if (!autoStartSupported()) return;
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      path: executablePath(),
      args: ['--hidden'],
      name: LOGIN_ITEM_NAME,
    });
  } catch (err) {
    log('error', 'Configuration du démarrage automatique impossible', String(err));
  }
}

export interface ShortcutActions {
  quickAdd: () => void;
  toggleWidgets: () => void;
  openDashboard: () => void;
}

/** (Ré)enregistre les raccourcis globaux. Retourne, pour chacun, s'il a pu être réservé. */
export function registerShortcuts(shortcuts: ShortcutSettings, actions: ShortcutActions): ShortcutStatus {
  globalShortcut.unregisterAll();
  const status: ShortcutStatus = { quickAdd: false, toggleWidgets: false, openDashboard: false };
  for (const key of Object.keys(status) as (keyof ShortcutSettings)[]) {
    const accelerator = shortcuts[key];
    if (!accelerator) continue;
    try {
      status[key] = globalShortcut.register(accelerator, actions[key]);
      if (!status[key]) log('warn', `Raccourci ${accelerator} déjà utilisé par une autre application`);
    } catch (err) {
      log('warn', `Raccourci ${accelerator} invalide`, String(err));
    }
  }
  return status;
}

export function notify(options: { title: string; body: string; silent?: boolean; urgent?: boolean; onClick?: () => void }): void {
  if (!Notification.isSupported()) return;
  try {
    const n = new Notification({
      title: options.title,
      body: options.body,
      silent: options.silent ?? false,
      icon: path.join(getAppPaths().resources, 'icon.png'),
      urgency: options.urgent ? 'critical' : 'normal',
      timeoutType: options.urgent ? 'never' : 'default',
    });
    if (options.onClick) n.on('click', options.onClick);
    n.show();
  } catch (err) {
    log('warn', 'Notification impossible', String(err));
  }
}
