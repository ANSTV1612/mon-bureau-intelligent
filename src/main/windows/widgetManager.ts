// Gestion des widgets : chaque widget est une vraie fenêtre native indépendante (sans cadre,
// transparente), dont la position, la taille, la visibilité et le mode « premier plan » sont
// mémorisés en base.

import { BrowserWindow, screen, type Rectangle, type WebContents } from 'electron';
import { WIDGET_META, WIDGET_ORDER } from '../../shared/defaults';
import type { ResizeEdge } from '../../shared/api';
import type { Settings, WidgetState, WidgetType } from '../../shared/types';
import type { DataService } from '../services/dataService';
import type { DesktopIntegration } from '../platform/desktop';
import { createAppWindow, loadRoute, safeSend } from './common';
import { log } from '../logger';

const MARGIN = 16;
const GAP = 4;
const SNAP_DISTANCE = 18;
const MAX_WIDTH = 1000;
const MAX_HEIGHT = 1400;

interface ResizeSession {
  type: WidgetType;
  edge: ResizeEdge;
  start: Rectangle;
  cursor: { x: number; y: number };
}

export class WidgetManager {
  private readonly windows = new Map<WidgetType, BrowserWindow>();
  private readonly states = new Map<WidgetType, WidgetState>();
  private readonly saveTimers = new Map<WidgetType, NodeJS.Timeout>();
  private readonly closingOnPurpose = new Set<WidgetType>();
  /** Widgets « premier plan » passés derrière une fenêtre maximisée (mode discret). */
  private readonly yielded = new Set<WidgetType>();
  /** Widgets « bureau » ramenés devant pendant l'affichage du bureau (Win+D, clic sur le fond d'écran). */
  private readonly raised = new Set<WidgetType>();
  private resizing: ResizeSession | null = null;
  private hiddenAll = false;
  private quitting = false;
  /** Base fermée : plus aucune écriture possible. */
  private stopped = false;
  private monitorTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly data: DataService,
    private readonly desktop: DesktopIntegration,
    private readonly onVisibilityChange: () => void,
  ) {}

  private get settings(): Settings {
    return this.data.getSettings();
  }

  init(): void {
    const stored = new Map(this.data.listWidgets().map((s) => [s.type, s]));
    const defaults = this.defaultLayout();
    for (const type of WIDGET_ORDER) {
      const state = this.fitOnScreen(stored.get(type) ?? defaults[type]);
      this.states.set(type, state);
      if (!stored.has(type)) this.data.saveWidgetState(state, false);
    }
    for (const state of this.states.values()) if (state.visible) this.open(state.type);
    const reposition = () => this.repositionAll();
    screen.on('display-removed', reposition);
    screen.on('display-added', reposition);
    screen.on('display-metrics-changed', reposition);
    this.updateMonitor();
  }

  // ------------------------------------------------------------------ Disposition

  /** Disposition initiale : colonnes alignées sur le bord droit de l'écran principal. */
  defaultLayout(): Record<WidgetType, WidgetState> {
    const wa = screen.getPrimaryDisplay().workArea;
    const order: WidgetType[] = ['today', 'priorities', 'progress', 'notes', 'upcoming', 'tasks', 'projects', 'reminders'];
    const result = {} as Record<WidgetType, WidgetState>;
    let columnRight = wa.x + wa.width - MARGIN;
    let columnWidth = 0;
    let y = wa.y + MARGIN;
    for (const type of order) {
      const meta = WIDGET_META[type];
      const width = Math.min(meta.defaultWidth, wa.width - 2 * MARGIN);
      const height = Math.min(meta.defaultHeight, wa.height - 2 * MARGIN);
      if (y + height > wa.y + wa.height - MARGIN && y > wa.y + MARGIN) {
        columnRight -= columnWidth + GAP;
        columnWidth = 0;
        y = wa.y + MARGIN;
      }
      const x = Math.max(wa.x, columnRight - width);
      result[type] = { type, visible: meta.defaultVisible, x, y, width, height, alwaysOnTop: false };
      columnWidth = Math.max(columnWidth, width);
      y += height + GAP;
    }
    return result;
  }

  /** Ramène un widget sur un écran existant (écran débranché, résolution modifiée…). */
  private fitOnScreen(state: WidgetState): WidgetState {
    const meta = WIDGET_META[state.type];
    const displays = screen.getAllDisplays();
    const visibleEnough = displays.some((d) => {
      const wa = d.workArea;
      const w = Math.min(state.x + state.width, wa.x + wa.width) - Math.max(state.x, wa.x);
      const h = Math.min(state.y + state.height, wa.y + wa.height) - Math.max(state.y, wa.y);
      return w >= 80 && h >= 40;
    });
    const display = screen.getDisplayMatching({ x: state.x, y: state.y, width: state.width, height: state.height });
    const wa = (visibleEnough ? display : screen.getPrimaryDisplay()).workArea;
    const width = Math.max(meta.minWidth, Math.min(state.width, wa.width, MAX_WIDTH));
    const height = Math.max(meta.minHeight, Math.min(state.height, wa.height, MAX_HEIGHT));
    let { x, y } = state;
    if (!visibleEnough) {
      x = wa.x + wa.width - width - MARGIN;
      y = wa.y + MARGIN;
    }
    x = Math.min(Math.max(x, wa.x - width + 80), wa.x + wa.width - 80);
    y = Math.min(Math.max(y, wa.y), wa.y + wa.height - 40);
    return { ...state, x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
  }

  private repositionAll(): void {
    for (const [type, state] of this.states) {
      const fitted = this.fitOnScreen(state);
      if (fitted.x !== state.x || fitted.y !== state.y || fitted.width !== state.width || fitted.height !== state.height) {
        this.states.set(type, fitted);
        const win = this.windows.get(type);
        if (win && !win.isDestroyed()) win.setBounds({ x: fitted.x, y: fitted.y, width: fitted.width, height: fitted.height });
        this.data.saveWidgetState(fitted, false);
      }
    }
  }

  // ------------------------------------------------------------------ Fenêtres

  private open(type: WidgetType): void {
    if (this.windows.has(type)) return;
    const state = this.states.get(type)!;
    const meta = WIDGET_META[type];
    const win = createAppWindow({
      x: state.x,
      y: state.y,
      width: state.width,
      height: state.height,
      minWidth: meta.minWidth,
      minHeight: meta.minHeight,
      title: `${meta.label} — Mon Bureau Intelligent`,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      thickFrame: false,
      resizable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      show: false,
      alwaysOnTop: state.alwaysOnTop,
      type: process.platform === 'linux' ? 'toolbar' : undefined,
    });
    this.windows.set(type, win);

    win.once('ready-to-show', () => {
      this.desktop.setToolWindow(win);
      this.applyLayer(type);
      if (!this.hiddenAll) win.showInactive();
    });

    if (process.platform === 'linux') {
      // Sous Linux, l'événement « moved » n'existe pas : on attend la fin du déplacement.
      win.on('move', () => this.scheduleSave(type, true));
    } else {
      win.on('move', () => this.scheduleSave(type, false));
      win.on('moved', () => {
        this.snap(type);
        this.scheduleSave(type, false);
      });
    }
    win.on('resize', () => {
      if (!this.resizing) this.scheduleSave(type, false);
    });
    win.on('closed', () => {
      this.windows.delete(type);
      this.yielded.delete(type);
      this.raised.delete(type);
      const intentional = this.closingOnPurpose.delete(type);
      // Fermeture non demandée (plantage du processus d'affichage, etc.) : on recrée le widget.
      if (!intentional && !this.quitting && this.states.get(type)?.visible) {
        log('warn', `Widget ${type} fermé de façon inattendue, recréation`);
        setTimeout(() => {
          if (!this.quitting && this.states.get(type)?.visible) this.open(type);
        }, 1500);
      }
    });
    win.webContents.on('render-process-gone', () => {
      if (!this.quitting) setTimeout(() => !win.isDestroyed() && win.reload(), 1000);
    });

    loadRoute(win, `widget/${type}`);
  }

  private close(type: WidgetType): void {
    const win = this.windows.get(type);
    if (!win) return;
    this.closingOnPurpose.add(type);
    this.flushSave(type);
    win.close();
  }

  /** Applique la couche d'affichage : toujours au premier plan, ou posé sur le bureau. */
  private applyLayer(type: WidgetType): void {
    const win = this.windows.get(type);
    const state = this.states.get(type);
    if (!win || !state || win.isDestroyed()) return;
    this.yielded.delete(type);
    this.raised.delete(type);
    if (state.alwaysOnTop) win.setAlwaysOnTop(true, 'floating');
    else win.setAlwaysOnTop(false);
  }

  // ------------------------------------------------------------------ Persistance

  private scheduleSave(type: WidgetType, snapAfter: boolean): void {
    if (this.quitting) return;
    clearTimeout(this.saveTimers.get(type));
    this.saveTimers.set(
      type,
      setTimeout(() => {
        this.saveTimers.delete(type);
        if (snapAfter) this.snap(type);
        this.saveBounds(type);
      }, snapAfter ? 350 : 500),
    );
  }

  private flushSave(type: WidgetType): void {
    const timer = this.saveTimers.get(type);
    if (timer) {
      clearTimeout(timer);
      this.saveTimers.delete(type);
      this.saveBounds(type);
    }
  }

  private saveBounds(type: WidgetType): void {
    if (this.stopped) return;
    const win = this.windows.get(type);
    const state = this.states.get(type);
    if (!win || win.isDestroyed() || !state) return;
    const b = win.getBounds();
    if (b.x === state.x && b.y === state.y && b.width === state.width && b.height === state.height) return;
    const next = { ...state, x: b.x, y: b.y, width: b.width, height: b.height };
    this.states.set(type, next);
    this.data.saveWidgetState(next);
  }

  private updateState(type: WidgetType, patch: Partial<WidgetState>): WidgetState {
    const next = { ...this.states.get(type)!, ...patch };
    this.states.set(type, next);
    this.data.saveWidgetState(next);
    return next;
  }

  /** Aimantation aux bords de l'écran et aux autres widgets. */
  private snap(type: WidgetType): void {
    if (!this.settings.snapWidgets) return;
    const win = this.windows.get(type);
    if (!win || win.isDestroyed()) return;
    const b = win.getBounds();
    const wa = screen.getDisplayMatching(b).workArea;
    const xs = [wa.x, wa.x + wa.width - b.width];
    const ys = [wa.y, wa.y + wa.height - b.height];
    for (const [other, w] of this.windows) {
      if (other === type || w.isDestroyed() || !w.isVisible()) continue;
      const o = w.getBounds();
      const nearV = b.y < o.y + o.height + SNAP_DISTANCE && b.y + b.height > o.y - SNAP_DISTANCE;
      const nearH = b.x < o.x + o.width + SNAP_DISTANCE && b.x + b.width > o.x - SNAP_DISTANCE;
      if (nearV) xs.push(o.x + o.width + GAP, o.x - b.width - GAP, o.x, o.x + o.width - b.width);
      if (nearH) ys.push(o.y + o.height + GAP, o.y - b.height - GAP, o.y, o.y + o.height - b.height);
    }
    const closest = (value: number, candidates: number[]) => {
      let best = value;
      let dist = SNAP_DISTANCE + 1;
      for (const c of candidates) {
        const d = Math.abs(c - value);
        if (d < dist) {
          dist = d;
          best = c;
        }
      }
      return best;
    };
    const x = closest(b.x, xs);
    const y = closest(b.y, ys);
    if (x !== b.x || y !== b.y) win.setPosition(Math.round(x), Math.round(y));
  }

  // ------------------------------------------------------------------ Actions publiques

  typeOf(contents: WebContents): WidgetType | null {
    for (const [type, win] of this.windows) if (!win.isDestroyed() && win.webContents === contents) return type;
    return null;
  }

  list(): WidgetState[] {
    return WIDGET_ORDER.map((t) => this.states.get(t)!).filter(Boolean);
  }

  get allHidden(): boolean {
    return this.hiddenAll;
  }

  setVisible(type: WidgetType, visible: boolean): void {
    this.updateState(type, { visible });
    if (visible) {
      if (this.hiddenAll) this.showAll();
      else this.open(type);
    } else this.close(type);
    this.updateMonitor();
    this.onVisibilityChange();
  }

  setAlwaysOnTop(type: WidgetType, alwaysOnTop: boolean): void {
    this.updateState(type, { alwaysOnTop });
    this.applyLayer(type);
    this.updateMonitor();
    this.onVisibilityChange();
  }

  hideAll(): void {
    this.hiddenAll = true;
    for (const [type, win] of this.windows) {
      this.flushSave(type);
      if (!win.isDestroyed()) win.hide();
    }
    this.onVisibilityChange();
  }

  /** Affiche tous les widgets actifs et les fait passer devant les autres fenêtres (coup d'œil). */
  showAll(): void {
    this.hiddenAll = false;
    for (const state of this.states.values()) {
      if (!state.visible) continue;
      const win = this.windows.get(state.type);
      if (!win) this.open(state.type);
      else if (!win.isDestroyed()) {
        win.showInactive();
        win.moveTop();
      }
    }
    this.onVisibilityChange();
  }

  toggleAll(): void {
    if (this.hiddenAll) this.showAll();
    else this.hideAll();
  }

  resetLayout(): void {
    for (const type of [...this.windows.keys()]) this.close(type);
    const defaults = this.defaultLayout();
    for (const type of WIDGET_ORDER) {
      this.states.set(type, defaults[type]);
      this.data.saveWidgetState(defaults[type], false);
    }
    this.data.emit('changed', 'widgets');
    this.hiddenAll = false;
    for (const state of this.states.values()) if (state.visible) this.open(state.type);
    this.updateMonitor();
    this.onVisibilityChange();
  }

  /** À appeler après une modification des paramètres. */
  applySettings(previous: Settings): void {
    const next = this.settings;
    if (previous.desktopAnchor !== next.desktopAnchor || previous.discreetMode !== next.discreetMode) {
      for (const type of this.windows.keys()) this.applyLayer(type);
      this.updateMonitor();
    }
  }

  // ------------------------------------------------------------------ Redimensionnement

  resizeStart(contents: WebContents, edge: ResizeEdge): void {
    const type = this.typeOf(contents);
    const win = type ? this.windows.get(type) : null;
    if (!type || !win || !['e', 's', 'se', 'w', 'sw'].includes(edge)) return;
    this.resizing = { type, edge, start: win.getBounds(), cursor: screen.getCursorScreenPoint() };
  }

  resizeMove(contents: WebContents): void {
    const r = this.resizing;
    if (!r || this.typeOf(contents) !== r.type) return;
    const win = this.windows.get(r.type);
    if (!win || win.isDestroyed()) return;
    const meta = WIDGET_META[r.type];
    const c = screen.getCursorScreenPoint();
    const dx = c.x - r.cursor.x;
    const dy = c.y - r.cursor.y;
    let { x, width, height } = r.start;
    const { y } = r.start;
    if (r.edge.includes('e')) width = r.start.width + dx;
    if (r.edge.includes('w')) width = r.start.width - dx;
    if (r.edge.includes('s')) height = r.start.height + dy;
    width = Math.max(meta.minWidth, Math.min(MAX_WIDTH, width));
    height = Math.max(meta.minHeight, Math.min(MAX_HEIGHT, height));
    if (r.edge.includes('w')) x = r.start.x + r.start.width - width;
    win.setBounds({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) });
  }

  resizeEnd(contents: WebContents): void {
    const r = this.resizing;
    if (!r || this.typeOf(contents) !== r.type) return;
    this.resizing = null;
    this.saveBounds(r.type);
  }

  // ------------------------------------------------------------------ Bureau et mode discret

  /**
   * Surveillance de la fenêtre active (Windows uniquement), deux fois par seconde :
   * - « Afficher le bureau » (Win+D ou clic sur le fond d'écran) : les widgets posés sur le bureau
   *   passent temporairement devant, puis repassent derrière l'application suivante ;
   * - mode discret : les widgets « premier plan » s'effacent devant une fenêtre maximisée ou en
   *   plein écran du même écran.
   */
  private updateMonitor(): void {
    const states = [...this.states.values()].filter((s) => s.visible);
    const needed =
      this.desktop.supported &&
      ((this.settings.desktopAnchor && states.some((s) => !s.alwaysOnTop)) ||
        (this.settings.discreetMode && states.some((s) => s.alwaysOnTop)));
    if (needed && !this.monitorTimer) {
      this.monitorTimer = setInterval(() => this.monitorTick(), 500);
    } else if (!needed && this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
      for (const type of new Set([...this.yielded, ...this.raised])) this.applyLayer(type);
    }
  }

  private monitorTick(): void {
    if (this.hiddenAll) return;
    const fg = this.desktop.foreground();
    // Fenêtre de l'application, barre des tâches, menu Démarrer… : aucun changement.
    if (!fg || fg.kind === 'own' || fg.kind === 'shell') return;
    const settings = this.settings;
    for (const [type, win] of this.windows) {
      const state = this.states.get(type);
      if (!state || win.isDestroyed() || !win.isVisible()) continue;
      if (!state.alwaysOnTop) {
        const showDesktop = settings.desktopAnchor && fg.kind === 'desktop';
        if (showDesktop && !this.raised.has(type)) {
          this.raised.add(type);
          win.setAlwaysOnTop(true, 'floating');
        } else if (!showDesktop && this.raised.has(type)) {
          this.raised.delete(type);
          win.setAlwaysOnTop(false);
          this.desktop.placeBehind(win, fg.handle);
        }
      } else {
        const shouldYield = settings.discreetMode && fg.kind === 'app' && fg.covering && this.desktop.monitorOf(win) === fg.monitor;
        if (shouldYield && !this.yielded.has(type)) {
          this.yielded.add(type);
          win.setAlwaysOnTop(false);
          this.desktop.placeBehind(win, fg.handle);
        } else if (!shouldYield && this.yielded.has(type)) {
          this.yielded.delete(type);
          win.setAlwaysOnTop(true, 'floating');
        }
      }
    }
  }

  // ------------------------------------------------------------------ Arrêt

  shutdown(): void {
    this.quitting = true;
    if (this.monitorTimer) clearInterval(this.monitorTimer);
    for (const type of [...this.saveTimers.keys()]) this.flushSave(type);
    for (const type of this.windows.keys()) this.saveBounds(type);
    this.stopped = true;
  }

  broadcast(channel: string, payload: unknown): void {
    for (const win of this.windows.values()) safeSend(win, channel, payload);
  }

  allWindows(): BrowserWindow[] {
    return [...this.windows.values()].filter((w) => !w.isDestroyed());
  }
}
