// Chien de garde du démarrage (Windows) : un petit processus séparé (Electron en mode Node) reçoit
// un battement par seconde du processus principal. Si les battements s'arrêtent trop longtemps
// (processus principal figé, par exemple par un appel système natif qui ne rend pas la main), il
// termine l'application et la relance. Au lancement suivant, le garde-fou de l'intégration Win32
// (fichier témoin) la désactive : l'application redevient utilisable sans intervention.
// Il ne surveille que les premières minutes, où ont lieu les premiers appels natifs.

import { spawn, type SpawnOptions } from 'node:child_process';
import { log } from './logger';

export interface WatchdogConfig {
  /** Processus surveillé. */
  pid: number;
  /** Programme et arguments pour relancer l'application. */
  exe: string;
  args: string[];
  timeoutMs: number;
  lifetimeMs: number;
  /** Journal des interventions du chien de garde (facultatif). */
  logFile?: string;
}

/** Code du processus de surveillance (exécuté avec `-e`, sans dépendance). */
export const WATCHDOG_SOURCE = `
const fs = require('fs');
const cfg = JSON.parse(process.env.MBI_WATCHDOG);
const note = (msg) => {
  if (!cfg.logFile) return;
  try { fs.appendFileSync(cfg.logFile, new Date().toISOString() + ' ' + msg + '\\n'); } catch (e) {}
};
let last = Date.now();
let rescuing = false;
process.on('message', (m) => {
  if (m === 'ok') last = Date.now();
  else if (m === 'stop' && !rescuing) process.exit(0);
});
// Fin normale de l'application : le canal se ferme, la surveillance s'arrête.
// (Pendant un sauvetage, la fermeture du canal est la conséquence de l'arrêt forcé : on continue.)
process.on('disconnect', () => { if (!rescuing) process.exit(0); });
const timer = setInterval(() => {
  if (Date.now() - last < cfg.timeoutMs) return;
  clearInterval(timer);
  rescuing = true;
  note('Aucun signal depuis ' + Math.round((Date.now() - last) / 1000) + ' s : arrêt du processus ' + cfg.pid);
  try { process.kill(cfg.pid); } catch (e) { note('Arrêt impossible : ' + e.message); }
  setTimeout(() => {
    const env = Object.assign({}, process.env);
    for (const k of Object.keys(env)) if (/^(ELECTRON_RUN_AS_NODE|MBI_WATCHDOG)$/i.test(k)) delete env[k];
    note('Relance : ' + cfg.exe + ' ' + cfg.args.join(' '));
    try {
      const { spawn } = require('child_process');
      const child = spawn(cfg.exe, cfg.args, { detached: true, stdio: 'ignore', env });
      child.on('error', (e) => note('Relance impossible : ' + e.message));
      child.unref();
    } catch (e) { note('Relance impossible : ' + e.message); }
    setTimeout(() => process.exit(0), 1000);
  }, 2500);
}, 500);
setTimeout(() => process.exit(0), cfg.lifetimeMs).unref();
`;

export interface Watchdog {
  stop(): void;
}

/** Options de lancement du processus de surveillance (partagées avec les tests). */
export const WATCHDOG_SPAWN_OPTIONS: SpawnOptions = {
  stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  windowsHide: true,
  // Indispensable sous Windows : un enfant non détaché appartient au « job » du processus
  // principal et serait tué en même temps que lui, avant d'avoir pu relancer l'application.
  detached: true,
};

/**
 * Démarre la surveillance. `runtime` est l'exécutable capable d'exécuter du JavaScript
 * (Electron avec ELECTRON_RUN_AS_NODE=1, ou Node.js pour les tests).
 */
export function startWatchdog(config: WatchdogConfig, runtime: string = process.execPath): Watchdog {
  let stopped = false;
  let beat: NodeJS.Timeout | null = null;
  let end: NodeJS.Timeout | null = null;
  try {
    const child = spawn(runtime, ['-e', WATCHDOG_SOURCE], {
      ...WATCHDOG_SPAWN_OPTIONS,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', MBI_WATCHDOG: JSON.stringify(config) },
    });
    const send = (m: string) => {
      try {
        if (child.connected) child.send(m);
      } catch {
        /* processus de surveillance terminé */
      }
    };
    const stop = () => {
      if (stopped) return;
      stopped = true;
      if (beat) clearInterval(beat);
      if (end) clearTimeout(end);
      send('stop');
    };
    beat = setInterval(() => send('ok'), 1000);
    end = setTimeout(stop, Math.max(0, config.lifetimeMs - 2000));
    child.on('error', (err) => {
      log('warn', 'Chien de garde indisponible', String(err));
      stop();
    });
    child.on('exit', () => {
      if (beat) clearInterval(beat);
    });
    child.unref();
    return { stop };
  } catch (err) {
    log('warn', 'Chien de garde indisponible', String(err));
    return { stop: () => undefined };
  }
}
