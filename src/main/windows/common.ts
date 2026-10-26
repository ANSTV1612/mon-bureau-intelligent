// Création sécurisée des fenêtres et chargement des vues de l'interface.

import { BrowserWindow, Menu, shell, type BrowserWindowConstructorOptions, type WebContents } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { log } from '../logger';

export interface AppPaths {
  preload: string;
  rendererIndex: string;
  devServerUrl: string | null;
  resources: string;
}

let paths: AppPaths;

export function setAppPaths(p: AppPaths): void {
  paths = p;
}

export function getAppPaths(): AppPaths {
  return paths;
}

export function appIconPath(): string {
  return path.join(paths.resources, process.platform === 'win32' ? 'icon.ico' : 'icon.png');
}

/** L'URL appartient-elle à notre interface (et non à une page externe) ? */
export function isTrustedUrl(url: string): boolean {
  if (!url) return false;
  if (paths.devServerUrl && url.startsWith(paths.devServerUrl)) return true;
  const base = pathToFileURL(paths.rendererIndex).toString();
  return url.split('#')[0] === base;
}

function harden(wc: WebContents): void {
  // Aucune navigation ni ouverture de fenêtre : les liens http(s) s'ouvrent dans le navigateur.
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (event, url) => {
    if (!isTrustedUrl(url)) event.preventDefault();
  });
  wc.on('will-attach-webview', (event) => event.preventDefault());
  // Menu contextuel natif en français pour les champs de saisie.
  wc.on('context-menu', (_event, params) => {
    if (!params.isEditable && !params.selectionText) return;
    const items: Electron.MenuItemConstructorOptions[] = [];
    for (const suggestion of params.dictionarySuggestions.slice(0, 4)) {
      items.push({ label: suggestion, click: () => wc.replaceMisspelling(suggestion) });
    }
    if (params.misspelledWord) {
      items.push(
        { label: 'Ajouter au dictionnaire', click: () => wc.session.addWordToSpellCheckerDictionary(params.misspelledWord) },
        { type: 'separator' },
      );
    }
    if (params.isEditable) {
      items.push(
        { label: 'Annuler', role: 'undo', enabled: params.editFlags.canUndo },
        { label: 'Rétablir', role: 'redo', enabled: params.editFlags.canRedo },
        { type: 'separator' },
        { label: 'Couper', role: 'cut', enabled: params.editFlags.canCut },
      );
    }
    items.push({ label: 'Copier', role: 'copy', enabled: params.editFlags.canCopy });
    if (params.isEditable) {
      items.push(
        { label: 'Coller', role: 'paste', enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { label: 'Tout sélectionner', role: 'selectAll' },
      );
    }
    Menu.buildFromTemplate(items).popup();
  });
  wc.on('render-process-gone', (_event, details) => {
    log('error', `Processus d'affichage arrêté (${details.reason})`, details);
  });
  wc.on('unresponsive', () => log('warn', 'Fenêtre ne répondant plus'));
  if (paths.devServerUrl) {
    wc.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') wc.toggleDevTools();
    });
  }
}

export function createAppWindow(options: BrowserWindowConstructorOptions): BrowserWindow {
  const win = new BrowserWindow({
    ...options,
    icon: appIconPath(),
    webPreferences: {
      preload: paths.preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: process.platform === 'win32' || process.platform === 'darwin',
      backgroundThrottling: false,
      ...options.webPreferences,
    },
  });
  win.removeMenu();
  harden(win.webContents);
  return win;
}

/**
 * Envoie un message à une fenêtre si elle est encore vivante. Pendant une fermeture, Electron détruit
 * le contenu web avant la fenêtre : les deux doivent être vérifiés.
 */
export function safeSend(win: BrowserWindow | null | undefined, channel: string, payload?: unknown): void {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
  try {
    win.webContents.send(channel, payload);
  } catch (err) {
    log('warn', `Envoi ${channel} impossible`, String(err));
  }
}

/** Charge une vue : route = 'dashboard', 'widget/today', 'quick-add', 'reminders'. */
export function loadRoute(win: BrowserWindow, route: string): void {
  const promise = paths.devServerUrl
    ? win.loadURL(`${paths.devServerUrl}#/${route}`)
    : win.loadFile(paths.rendererIndex, { hash: `/${route}` });
  promise.catch((err) => {
    // Fenêtre fermée pendant son chargement : interruption normale, pas une erreur.
    if (win.isDestroyed() || win.webContents.isDestroyed()) return;
    log('error', `Chargement de la vue ${route} impossible`, String(err));
  });
}
