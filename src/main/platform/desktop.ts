// Intégration au bureau Windows via l'API Win32 (bibliothèque FFI Koffi, binaire précompilé).
//
// Uniquement des lectures (fenêtre active, sa classe, son écran) et des réglages sur NOS propres
// fenêtres (style « fenêtre outil », position dans l'empilement). Aucune relation avec les fenêtres
// de l'Explorateur Windows n'est créée, pour ne jamais dépendre de son état.
//
// Utilisations :
// - « Afficher le bureau » (Win+D ou clic sur le fond d'écran) : détecté pour garder les widgets visibles ;
// - mode discret : détection d'une fenêtre maximisée ou en plein écran ;
// - widgets absents de la barre des tâches et d'Alt+Tab.
//
// Garde-fou : chaque type d'appel natif est encadré par un fichier témoin. Si un appel ne rendait
// jamais la main (blocage), le témoin resterait présent et l'intégration serait automatiquement
// désactivée au lancement suivant (l'application fonctionne alors avec le comportement standard).

import type { BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { log } from '../logger';

export type ForegroundKind = 'own' | 'desktop' | 'shell' | 'app';

export interface ForegroundInfo {
  handle: number;
  /** own = une fenêtre de l'application ; desktop = fond d'écran ; shell = barre des tâches… ; app = autre logiciel */
  kind: ForegroundKind;
  /** La fenêtre occupe tout son écran (maximisée ou plein écran). */
  covering: boolean;
  monitor: number;
}

export interface DesktopIntegration {
  readonly supported: boolean;
  /** Raison de la désactivation automatique (garde-fou), sinon null. */
  readonly disabledReason: string | null;
  /** Style « fenêtre outil » : absente de la barre des tâches et d'Alt+Tab. */
  setToolWindow(win: BrowserWindow): void;
  /** Place `win` juste derrière la fenêtre `behind` dans l'ordre d'empilement. */
  placeBehind(win: BrowserWindow, behind: number): void;
  foreground(): ForegroundInfo | null;
  monitorOf(win: BrowserWindow): number;
}

function noop(disabledReason: string | null = null): DesktopIntegration {
  return {
    supported: false,
    disabledReason,
    setToolWindow: () => undefined,
    placeBehind: () => undefined,
    foreground: () => null,
    monitorOf: () => 0,
  };
}

const GWL_EXSTYLE = -20;
const WS_EX_TOOLWINDOW = 0x00000080;
const WS_EX_APPWINDOW = 0x00040000;
const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOACTIVATE = 0x0010;
const SWP_NOOWNERZORDER = 0x0200;
const MONITOR_DEFAULTTONEAREST = 2;
const DESKTOP_CLASSES = new Set(['Progman', 'WorkerW']);
const SHELL_CLASSES = new Set([
  'Shell_TrayWnd',
  'Shell_SecondaryTrayWnd',
  'NotifyIconOverflowWindow',
  'TopLevelWindowForOverflowXamlIsland',
  'XamlExplorerHostIslandWindow',
  'MultitaskingViewFrame',
  'TaskListThumbnailWnd',
  'ForegroundStaging',
]);

const GUARD_FILE = 'win32-appel-en-cours.txt';
const DISABLED_FILE = 'win32-desactive.txt';

function handleOf(win: BrowserWindow): number {
  const buf = win.getNativeWindowHandle();
  return Number(buf.length >= 8 ? buf.readBigUInt64LE(0) : BigInt(buf.readUInt32LE(0)));
}

/** Réactive l'intégration après une désactivation automatique (prise en compte au prochain lancement). */
export function resetDesktopGuard(guardDir: string): void {
  fs.rmSync(path.join(guardDir, DISABLED_FILE), { force: true });
  fs.rmSync(path.join(guardDir, GUARD_FILE), { force: true });
}

export interface DesktopOptions {
  /** Pour les tests : plateforme simulée et chargeur de Koffi de substitution. */
  platform?: NodeJS.Platform;
  loadKoffi?: () => unknown;
}

export function createDesktopIntegration(guardDir: string, options: DesktopOptions = {}): DesktopIntegration {
  if ((options.platform ?? process.platform) !== 'win32') return noop();

  const guardFile = path.join(guardDir, GUARD_FILE);
  const disabledFile = path.join(guardDir, DISABLED_FILE);
  try {
    fs.mkdirSync(guardDir, { recursive: true });
    if (fs.existsSync(disabledFile)) {
      return noop(fs.readFileSync(disabledFile, 'utf8') || "désactivée après un incident lors d'un lancement précédent");
    }
    if (fs.existsSync(guardFile)) {
      const call = fs.readFileSync(guardFile, 'utf8');
      const reason = `l'appel système « ${call} » ne s'est pas terminé lors du lancement précédent`;
      fs.writeFileSync(disabledFile, reason);
      fs.rmSync(guardFile, { force: true });
      log('error', `Intégration Win32 désactivée automatiquement : ${reason}`);
      return noop(reason);
    }
  } catch (err) {
    log('warn', 'Garde-fou Win32 inaccessible', String(err));
  }

  const verified = new Set<string>();
  /** Le premier appel de chaque fonction native est encadré par le fichier témoin. */
  function guarded<T>(name: string, fn: () => T): T {
    if (verified.has(name)) return fn();
    try {
      fs.writeFileSync(guardFile, name);
    } catch {
      /* écriture impossible : on poursuit sans témoin */
    }
    try {
      return fn();
    } finally {
      fs.rmSync(guardFile, { force: true });
      verified.add(name);
    }
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
    const koffi: any = options.loadKoffi ? options.loadKoffi() : require('koffi');
    const user32 = koffi.load('user32.dll');
    const RECT = koffi.struct('MBI_RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
    const MONITORINFO = koffi.struct('MBI_MONITORINFO', {
      cbSize: 'uint32',
      rcMonitor: RECT,
      rcWork: RECT,
      dwFlags: 'uint32',
    });
    const GetWindowLongPtrW = user32.func('intptr_t __stdcall GetWindowLongPtrW(intptr_t hWnd, int nIndex)');
    const SetWindowLongPtrW = user32.func('intptr_t __stdcall SetWindowLongPtrW(intptr_t hWnd, int nIndex, intptr_t value)');
    const SetWindowPos = user32.func(
      'bool __stdcall SetWindowPos(intptr_t hWnd, intptr_t after, int x, int y, int cx, int cy, uint32_t flags)',
    );
    const GetForegroundWindow = user32.func('intptr_t __stdcall GetForegroundWindow()');
    const IsZoomed = user32.func('bool __stdcall IsZoomed(intptr_t hWnd)');
    const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(intptr_t hWnd)');
    const GetClassNameW = user32.func('int __stdcall GetClassNameW(intptr_t hWnd, void *buffer, int max)');
    const GetWindowRect = user32.func('bool __stdcall GetWindowRect(intptr_t hWnd, _Out_ MBI_RECT *rect)');
    const MonitorFromWindow = user32.func('intptr_t __stdcall MonitorFromWindow(intptr_t hWnd, uint32_t flags)');
    const GetMonitorInfoW = user32.func('bool __stdcall GetMonitorInfoW(intptr_t hMonitor, _Inout_ MBI_MONITORINFO *info)');
    const GetWindowThreadProcessId = user32.func('uint32_t __stdcall GetWindowThreadProcessId(intptr_t hWnd, _Out_ uint32_t *pid)');

    const classBuffer = Buffer.alloc(512);
    const className = (h: number): string => {
      const n = guarded('GetClassNameW', () => GetClassNameW(h, classBuffer, 256) as number);
      return n > 0 ? classBuffer.toString('utf16le', 0, n * 2) : '';
    };

    const integration: DesktopIntegration = {
      supported: true,
      disabledReason: null,
      setToolWindow(win) {
        try {
          const h = handleOf(win);
          const style = Number(guarded('GetWindowLongPtrW', () => GetWindowLongPtrW(h, GWL_EXSTYLE)));
          guarded('SetWindowLongPtrW', () => SetWindowLongPtrW(h, GWL_EXSTYLE, (style | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW));
        } catch (err) {
          log('warn', 'Style fenêtre outil impossible', String(err));
        }
      },
      placeBehind(win, behind) {
        try {
          const h = handleOf(win);
          guarded('SetWindowPos', () => SetWindowPos(h, behind, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER));
        } catch (err) {
          log('warn', 'Réordonnancement impossible', String(err));
        }
      },
      foreground() {
        try {
          const h = Number(guarded('GetForegroundWindow', () => GetForegroundWindow()));
          if (!h || !guarded('IsWindowVisible', () => IsWindowVisible(h))) return null;
          const pid = [0];
          guarded('GetWindowThreadProcessId', () => GetWindowThreadProcessId(h, pid));
          const monitor = Number(guarded('MonitorFromWindow', () => MonitorFromWindow(h, MONITOR_DEFAULTTONEAREST)));
          if (pid[0] === process.pid) return { handle: h, kind: 'own', covering: false, monitor };
          const cls = className(h);
          if (DESKTOP_CLASSES.has(cls)) return { handle: h, kind: 'desktop', covering: false, monitor };
          if (SHELL_CLASSES.has(cls)) return { handle: h, kind: 'shell', covering: false, monitor };
          let covering = Boolean(guarded('IsZoomed', () => IsZoomed(h)));
          if (!covering) {
            const rect: Record<string, number> = {};
            guarded('GetWindowRect', () => GetWindowRect(h, rect));
            const info: { cbSize: number; rcMonitor?: Record<string, number> } = { cbSize: koffi.sizeof(MONITORINFO) };
            if (guarded('GetMonitorInfoW', () => GetMonitorInfoW(monitor, info)) && info.rcMonitor) {
              const m = info.rcMonitor;
              covering = rect.left <= m.left && rect.top <= m.top && rect.right >= m.right && rect.bottom >= m.bottom;
            }
          }
          return { handle: h, kind: 'app', covering, monitor };
        } catch (err) {
          log('warn', 'Lecture de la fenêtre active impossible', String(err));
          return null;
        }
      },
      monitorOf(win) {
        try {
          return Number(guarded('MonitorFromWindow', () => MonitorFromWindow(handleOf(win), MONITOR_DEFAULTTONEAREST)));
        } catch {
          return 0;
        }
      },
    };
    log('info', 'Intégration Win32 active');
    return integration;
  } catch (err) {
    log('warn', 'Intégration Win32 indisponible, comportement standard utilisé', String(err));
    return noop();
  }
}
