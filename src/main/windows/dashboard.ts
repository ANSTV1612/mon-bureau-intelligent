// Tableau de bord complet (fenêtre classique avec barre de titre intégrée).

import { BrowserWindow, nativeTheme, screen, type Rectangle } from 'electron';
import { IPC, type DashboardRoute } from '../../shared/api';
import type { DataService } from '../services/dataService';
import { createAppWindow, loadRoute, safeSend } from './common';

const OVERLAY_HEIGHT = 44;

export class DashboardWindow {
  private win: BrowserWindow | null = null;
  private loaded = false;
  private pendingRoute: DashboardRoute | null = null;
  private quitting = false;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly data: DataService,
    private readonly onHiddenToTray: () => void,
    private readonly onCloseRequest: () => void,
  ) {}

  get window(): BrowserWindow | null {
    return this.win && !this.win.isDestroyed() ? this.win : null;
  }

  private colors() {
    const dark = nativeTheme.shouldUseDarkColors;
    return {
      background: dark ? '#14161c' : '#f6f7fb',
      overlay: dark ? '#14161c' : '#f6f7fb',
      symbol: dark ? '#e7e9ee' : '#1f2430',
    };
  }

  private restoreBounds(): Partial<Rectangle> {
    const saved = this.data.getMeta<Rectangle>('dashboardBounds');
    const wa = screen.getPrimaryDisplay().workArea;
    const fallback = {
      width: Math.min(1240, wa.width - 80),
      height: Math.min(820, wa.height - 60),
    };
    if (!saved || ![saved.x, saved.y, saved.width, saved.height].every((n) => Number.isFinite(n))) return fallback;
    const onScreen = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return saved.x < a.x + a.width - 100 && saved.x + saved.width > a.x + 100 && saved.y >= a.y - 10 && saved.y < a.y + a.height - 60;
    });
    return onScreen ? saved : fallback;
  }

  private create(): BrowserWindow {
    const c = this.colors();
    const win = createAppWindow({
      ...this.restoreBounds(),
      minWidth: 900,
      minHeight: 600,
      title: 'Mon Bureau Intelligent',
      show: false,
      backgroundColor: c.background,
      titleBarStyle: 'hidden',
      titleBarOverlay: process.platform === 'darwin' ? true : { color: c.overlay, symbolColor: c.symbol, height: OVERLAY_HEIGHT },
    });
    this.loaded = false;
    win.webContents.on('did-finish-load', () => {
      this.loaded = true;
      if (this.pendingRoute) {
        safeSend(win, IPC.appNavigate, this.pendingRoute);
        this.pendingRoute = null;
      }
    });
    win.once('ready-to-show', () => {
      if (this.data.getMeta<boolean>('dashboardMaximized')) win.maximize();
      win.show();
    });
    const scheduleSave = () => {
      if (this.saveTimer) clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => {
        if (win.isDestroyed() || this.quitting) return;
        this.data.setMeta('dashboardMaximized', win.isMaximized());
        if (!win.isMaximized() && !win.isMinimized()) this.data.setMeta('dashboardBounds', win.getBounds());
      }, 600);
    };
    win.on('resize', scheduleSave);
    win.on('move', scheduleSave);
    win.on('close', (event) => {
      if (this.quitting) return;
      if (this.data.getSettings().closeToTray) {
        event.preventDefault();
        win.hide();
        this.onHiddenToTray();
      } else {
        event.preventDefault();
        this.onCloseRequest();
      }
    });
    win.on('closed', () => {
      this.win = null;
      this.loaded = false;
    });
    loadRoute(win, 'dashboard');
    return win;
  }

  open(route?: DashboardRoute | null): void {
    if (!this.window) this.win = this.create();
    const win = this.win!;
    if (route) {
      if (this.loaded) safeSend(win, IPC.appNavigate, route);
      else this.pendingRoute = route;
    }
    if (win.isMinimized()) win.restore();
    if (this.loaded || win.isVisible()) {
      win.show();
      win.focus();
    }
  }

  isVisible(): boolean {
    return !!this.window?.isVisible();
  }

  updateTheme(): void {
    const win = this.window;
    if (!win) return;
    const c = this.colors();
    win.setBackgroundColor(c.background);
    if (process.platform !== 'darwin') {
      try {
        win.setTitleBarOverlay({ color: c.overlay, symbolColor: c.symbol, height: OVERLAY_HEIGHT });
      } catch {
        /* non pris en charge sur cette plateforme */
      }
    }
  }

  shutdown(): void {
    this.quitting = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);
  }
}
