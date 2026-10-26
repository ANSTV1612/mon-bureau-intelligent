// Journal local (fichier texte, rotation à 1 Mo). Aucune donnée n'est envoyée sur Internet.

import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from './storage/database';

const MAX_SIZE = 1_000_000;
let logFile: string | null = null;

export function initLogger(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  logFile = path.join(dir, 'main.log');
  try {
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > MAX_SIZE) {
      fs.renameSync(logFile, path.join(dir, 'main.old.log'));
    }
  } catch {
    /* rotation impossible : on continue dans le même fichier */
  }
}

function format(extra: unknown): string {
  if (extra === undefined) return '';
  if (extra instanceof Error) return ` ${extra.stack ?? extra.message}`;
  try {
    return ` ${typeof extra === 'string' ? extra : JSON.stringify(extra)}`;
  } catch {
    return ` ${String(extra)}`;
  }
}

export const log: Logger = (level, message, extra) => {
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${message}${format(extra)}\n`;
  if (process.env.NODE_ENV === 'development' || level === 'error') process.stderr.write(line);
  if (!logFile) return;
  try {
    fs.appendFileSync(logFile, line);
  } catch {
    /* disque plein ou fichier verrouillé : on ignore pour ne pas bloquer l'application */
  }
};
