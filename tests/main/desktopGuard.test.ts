import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDesktopIntegration, resetDesktopGuard } from '../../src/main/platform/desktop';

let dir: string;
const guard = () => path.join(dir, 'win32-appel-en-cours.txt');
const disabled = () => path.join(dir, 'win32-desactive.txt');

/** Faux Koffi : chaque fonction native vérifie que le fichier témoin existe pendant son exécution. */
function fakeKoffi(calls: string[]) {
  const make = (name: string, result: unknown) => (...args: unknown[]) => {
    calls.push(`${name}:${fs.existsSync(guard()) ? 'guarded' : 'free'}`);
    if (name === 'GetWindowThreadProcessId') (args[1] as number[])[0] = 4242;
    if (name === 'GetClassNameW') {
      (args[1] as Buffer).write('Progman', 'utf16le');
      return 7;
    }
    return result;
  };
  const results: Record<string, unknown> = {
    GetForegroundWindow: 77,
    IsWindowVisible: true,
    GetWindowThreadProcessId: 1,
    MonitorFromWindow: 5,
    GetWindowLongPtrW: 0x100,
    SetWindowLongPtrW: 0,
    SetWindowPos: true,
    IsZoomed: false,
    GetWindowRect: true,
    GetMonitorInfoW: true,
  };
  return {
    load: () => ({
      func: (proto: string) => {
        const name = /(\w+)\(/.exec(proto)![1];
        return make(name, results[name]);
      },
    }),
    struct: () => ({}),
    sizeof: () => 40,
  };
}

const fakeWindow = { getNativeWindowHandle: () => Buffer.from([1, 2, 0, 0, 0, 0, 0, 0]) } as never;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbi-guard-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('garde-fou de l’intégration Win32', () => {
  it('est inactif hors Windows', () => {
    const d = createDesktopIntegration(dir, { platform: 'linux' });
    expect(d.supported).toBe(false);
    expect(d.foreground()).toBeNull();
  });

  it('encadre le premier appel de chaque fonction par un fichier témoin, puis le retire', () => {
    const calls: string[] = [];
    const d = createDesktopIntegration(dir, { platform: 'win32', loadKoffi: () => fakeKoffi(calls) });
    expect(d.supported).toBe(true);
    d.setToolWindow(fakeWindow);
    const fg = d.foreground();
    expect(fg).toMatchObject({ handle: 77, kind: 'desktop' });
    d.foreground();
    expect(fs.existsSync(guard())).toBe(false);
    expect(calls.slice(0, 2)).toEqual(['GetWindowLongPtrW:guarded', 'SetWindowLongPtrW:guarded']);
    // Les appels suivants d'une fonction déjà vérifiée ne sont plus encadrés.
    expect(calls.filter((c) => c.startsWith('GetForegroundWindow'))).toEqual(['GetForegroundWindow:guarded', 'GetForegroundWindow:free']);
  });

  it("désactive l'intégration si un appel ne s'est pas terminé au lancement précédent", () => {
    fs.writeFileSync(guard(), 'SetWindowLongPtrW');
    const d = createDesktopIntegration(dir, { platform: 'win32', loadKoffi: () => fakeKoffi([]) });
    expect(d.supported).toBe(false);
    expect(d.disabledReason).toMatch(/SetWindowLongPtrW/);
    expect(fs.existsSync(disabled())).toBe(true);
    // Reste désactivée aux lancements suivants…
    expect(createDesktopIntegration(dir, { platform: 'win32', loadKoffi: () => fakeKoffi([]) }).supported).toBe(false);
    // …jusqu'à la réactivation explicite.
    resetDesktopGuard(dir);
    expect(createDesktopIntegration(dir, { platform: 'win32', loadKoffi: () => fakeKoffi([]) }).supported).toBe(true);
  });

  it('se replie sur le comportement standard si Koffi est absent', () => {
    const d = createDesktopIntegration(dir, {
      platform: 'win32',
      loadKoffi: () => {
        throw new Error('module introuvable');
      },
    });
    expect(d.supported).toBe(false);
    expect(d.disabledReason).toBeNull();
  });
});
