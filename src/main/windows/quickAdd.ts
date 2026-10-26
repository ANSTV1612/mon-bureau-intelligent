// Fenêtre de saisie rapide, ouverte par le raccourci clavier global (Ctrl+Alt+N par défaut).

import { BrowserWindow, screen } from 'electron';
import { IPC } from '../../shared/api';
import { createAppWindow, loadRoute, safeSend } from './common';

const WIDTH = 640;
const HEIGHT = 420;

export class QuickAddWindow {
  private win: BrowserWindow | null = null;
  private ready = false;
  private showWhenReady = false;

  private create(): BrowserWindow {
    const win = createAppWindow({
      width: WIDTH,
      height: HEIGHT,
      title: 'Nouvelle tâche — Mon Bureau Intelligent',
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      thickFrame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
    });
    win.setAlwaysOnTop(true, 'pop-up-menu');
    win.webContents.on('did-finish-load', () => {
      this.ready = true;
      if (this.showWhenReady) {
        this.showWhenReady = false;
        this.show();
      }
    });
    win.on('blur', () => {
      setTimeout(() => {
        if (!win.isDestroyed() && !win.isFocused() && !win.webContents.isDevToolsOpened()) win.hide();
      }, 120);
    });
    win.on('closed', () => {
      this.win = null;
      this.ready = false;
    });
    loadRoute(win, 'quick-add');
    return win;
  }

  /** Pré-charge la fenêtre (masquée) pour une ouverture instantanée. */
  prepare(): void {
    if (!this.win) this.win = this.create();
  }

  show(): void {
    if (this.win?.isDestroyed()) this.win = null;
    if (!this.win) this.win = this.create();
    const win = this.win;
    if (!this.ready) {
      this.showWhenReady = true;
      return;
    }
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const wa = display.workArea;
    win.setBounds({
      x: Math.round(wa.x + (wa.width - WIDTH) / 2),
      y: Math.round(wa.y + wa.height * 0.18),
      width: WIDTH,
      height: HEIGHT,
    });
    win.show();
    win.focus();
    win.webContents.focus();
    safeSend(win, IPC.appQuickAddShown);
  }

  hide(): void {
    if (this.win && !this.win.isDestroyed()) this.win.hide();
  }

  owns(win: BrowserWindow | null): boolean {
    return !!win && win === this.win;
  }

  destroy(): void {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
  }
}
