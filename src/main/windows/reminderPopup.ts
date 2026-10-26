// Fenêtre de rappels (coin inférieur droit) : fonctionne même si les notifications Windows sont
// désactivées ou bloquées par l'assistant de concentration. Boutons Terminer / Reporter / Ouvrir.

import { BrowserWindow, screen } from 'electron';
import { IPC } from '../../shared/api';
import type { FiredReminder, Task } from '../../shared/types';
import { createAppWindow, loadRoute, safeSend } from './common';

const WIDTH = 380;
const MARGIN = 12;

export class ReminderPopup {
  private win: BrowserWindow | null = null;
  private ready = false;
  private pending: FiredReminder[] = [];
  private height = 160;

  get items(): FiredReminder[] {
    return this.pending;
  }

  private create(): BrowserWindow {
    const win = createAppWindow({
      width: WIDTH,
      height: this.height,
      title: 'Rappels — Mon Bureau Intelligent',
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
      focusable: true,
      show: false,
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.webContents.on('did-finish-load', () => {
      this.ready = true;
      this.push();
      this.reveal();
    });
    win.on('closed', () => {
      this.win = null;
      this.ready = false;
    });
    loadRoute(win, 'reminders');
    return win;
  }

  private position(): void {
    if (!this.win || this.win.isDestroyed()) return;
    const wa = screen.getPrimaryDisplay().workArea;
    this.win.setBounds({
      x: wa.x + wa.width - WIDTH - MARGIN,
      y: wa.y + wa.height - this.height - MARGIN,
      width: WIDTH,
      height: this.height,
    });
  }

  private push(): void {
    if (this.ready) safeSend(this.win, IPC.remindersPush, this.pending);
  }

  private reveal(): void {
    if (!this.win || this.win.isDestroyed() || !this.pending.length) return;
    this.position();
    this.win.showInactive();
    this.win.moveTop();
  }

  add(items: FiredReminder[]): void {
    for (const item of items) {
      if (!this.pending.some((p) => p.taskId === item.taskId && p.reminderId === item.reminderId)) this.pending.unshift(item);
    }
    this.pending = this.pending.slice(0, 20);
    if (this.win?.isDestroyed()) this.win = null;
    if (!this.win) {
      this.win = this.create();
      return;
    }
    this.push();
    this.reveal();
  }

  dismiss(taskId: string, reminderId: string | null): void {
    this.pending = this.pending.filter((p) => !(p.taskId === taskId && (reminderId === null || p.reminderId === reminderId)));
    this.afterChange();
  }

  dismissAll(): void {
    this.pending = [];
    this.afterChange();
  }

  /** Retire les rappels dont la tâche a été terminée ou supprimée. */
  sync(tasks: Task[]): void {
    const open = new Set(tasks.filter((t) => t.status !== 'done').map((t) => t.id));
    const before = this.pending.length;
    this.pending = this.pending.filter((p) => open.has(p.taskId));
    if (this.pending.length !== before) this.afterChange();
  }

  setHeight(height: number): void {
    if (!Number.isFinite(height)) return;
    const wa = screen.getPrimaryDisplay().workArea;
    this.height = Math.round(Math.max(90, Math.min(height, wa.height - 2 * MARGIN, 640)));
    this.position();
  }

  private afterChange(): void {
    this.push();
    if (!this.pending.length && this.win && !this.win.isDestroyed()) this.win.hide();
  }

  owns(win: BrowserWindow | null): boolean {
    return !!win && win === this.win;
  }

  destroy(): void {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
  }
}
