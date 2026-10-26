// Accès SQLite via le module intégré `node:sqlite` (aucun module natif à compiler).
// Ce fichier n'importe pas Electron : il est testé directement sous Node.

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export type Logger = (level: 'info' | 'warn' | 'error', message: string, extra?: unknown) => void;

const noopLogger: Logger = () => undefined;

/** Migrations successives du schéma. L'index + 1 correspond à `PRAGMA user_version`. */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    sort_order REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    due_date TEXT,
    due_time TEXT,
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','done')),
    reminders TEXT NOT NULL DEFAULT '[]',
    sort_order REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
  );
  CREATE INDEX idx_tasks_due ON tasks(due_date);
  CREATE INDEX idx_tasks_status ON tasks(status);
  CREATE INDEX idx_tasks_project ON tasks(project_id);
  CREATE TABLE notes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    sort_order REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE widgets (type TEXT PRIMARY KEY, state TEXT NOT NULL);
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export interface OpenResult {
  db: DatabaseSync;
  /** Message destiné à l'utilisateur si la base a dû être réparée ou recréée. */
  warning: string | null;
}

function configure(db: DatabaseSync): void {
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = FULL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 3000;');
}

export function migrate(db: DatabaseSync, log: Logger = noopLogger): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  const current = row.user_version;
  if (current > SCHEMA_VERSION) {
    throw new Error(
      `La base de données provient d'une version plus récente de l'application (schéma ${current} > ${SCHEMA_VERSION}).`,
    );
  }
  for (let v = current; v < SCHEMA_VERSION; v++) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
      log('info', `Migration du schéma vers la version ${v + 1}`);
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

function integrityOk(db: DatabaseSync): boolean {
  const rows = db.prepare('PRAGMA quick_check').all() as Record<string, unknown>[];
  return rows.length === 1 && Object.values(rows[0])[0] === 'ok';
}

function moveAside(filePath: string, suffix: string): void {
  for (const ext of ['', '-wal', '-shm']) {
    const f = filePath + ext;
    if (fs.existsSync(f)) fs.renameSync(f, `${filePath}.${suffix}${ext}`);
  }
}

export function listBackups(backupDir: string): { file: string; date: string; size: number }[] {
  if (!fs.existsSync(backupDir)) return [];
  return fs
    .readdirSync(backupDir)
    .filter((f) => /^mbi-\d{4}-\d{2}-\d{2}(-[\w-]+)?\.db$/.test(f))
    .map((f) => {
      const full = path.join(backupDir, f);
      const stat = fs.statSync(full);
      return { file: full, date: stat.mtime.toISOString(), size: stat.size };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Ouvre (ou crée) la base. En cas de corruption, le fichier est mis de côté et la dernière
 * sauvegarde automatique est restaurée ; à défaut, une base vide est créée.
 */
export function openDatabase(filePath: string, backupDir: string | null, log: Logger = noopLogger): OpenResult {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let warning: string | null = null;
  try {
    const db = new DatabaseSync(filePath);
    try {
      configure(db);
      if (!integrityOk(db)) throw new Error('quick_check a échoué');
      migrate(db, log);
      return { db, warning };
    } catch (err) {
      try {
        db.close();
      } catch {
        /* déjà fermée */
      }
      throw err;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('version plus récente')) throw err;
    log('error', 'Base de données illisible, tentative de récupération', message);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    moveAside(filePath, `corrompu-${stamp}`);
    const backups = backupDir ? listBackups(backupDir) : [];
    for (const backup of backups) {
      try {
        fs.copyFileSync(backup.file, filePath);
        const db = new DatabaseSync(filePath);
        configure(db);
        if (!integrityOk(db)) {
          db.close();
          fs.rmSync(filePath, { force: true });
          continue;
        }
        migrate(db, log);
        warning = `Le fichier de données était endommagé. Vos données ont été restaurées depuis la sauvegarde du ${new Date(
          backup.date,
        ).toLocaleDateString('fr-FR')}. L'ancien fichier a été conservé à côté pour analyse.`;
        return { db, warning };
      } catch (restoreErr) {
        log('error', `Échec de restauration depuis ${backup.file}`, String(restoreErr));
        fs.rmSync(filePath, { force: true });
      }
    }
    const db = new DatabaseSync(filePath);
    configure(db);
    migrate(db, log);
    warning =
      "Le fichier de données était endommagé et aucune sauvegarde n'a pu être restaurée. Une nouvelle base vide a été créée ; l'ancien fichier a été conservé à côté.";
    return { db, warning };
  }
}

/** Exécute `fn` dans une transaction (annulée en cas d'erreur). */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * Sauvegarde cohérente de la base (VACUUM INTO). Conserve les `keep` sauvegardes quotidiennes
 * les plus récentes. Retourne le chemin créé.
 */
export function backupDatabase(db: DatabaseSync, backupDir: string, label: string | null = null, keep = 7): string {
  fs.mkdirSync(backupDir, { recursive: true });
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const name = label ? `mbi-${day}-${label}.db` : `mbi-${day}.db`;
  const target = path.join(backupDir, name);
  if (fs.existsSync(target)) fs.rmSync(target);
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  // Rotation : sauvegardes quotidiennes et sauvegardes étiquetées (avant import, etc.) séparément.
  const all = listBackups(backupDir);
  const daily = all.filter((b) => /mbi-\d{4}-\d{2}-\d{2}\.db$/.test(b.file));
  const labelled = all.filter((b) => !/mbi-\d{4}-\d{2}-\d{2}\.db$/.test(b.file));
  for (const old of [...daily.slice(keep), ...labelled.slice(keep)]) fs.rmSync(old.file, { force: true });
  return target;
}
