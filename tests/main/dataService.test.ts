import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, SCHEMA_VERSION } from '../../src/main/storage/database';
import { DataService } from '../../src/main/services/dataService';
import { NOW } from '../helpers/factory';

let dir: string;
let service: DataService;
let clock: Date;

function open(): DataService {
  const { db, warning } = openDatabase(path.join(dir, 'data.db'), path.join(dir, 'backups'));
  expect(warning).toBeNull();
  return new DataService(db, { backupDir: path.join(dir, 'backups'), now: () => clock });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbi-test-'));
  clock = new Date(NOW);
  service = open();
});

afterEach(() => {
  try {
    service.close();
  } catch {
    /* déjà fermée */
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

function ok<T>(r: { ok: true; value: T } | { ok: false; errors: Record<string, string> }): T {
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.value;
}

describe('base de données', () => {
  it('crée le schéma et le met à la bonne version', () => {
    const { db } = openDatabase(path.join(dir, 'other.db'), null);
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(SCHEMA_VERSION);
    expect((db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode).toBe('wal');
    db.close();
  });

  it('conserve les données après fermeture et réouverture (redémarrage du PC)', () => {
    const t = ok(service.createTask({ title: 'Persistante', dueDate: '2026-10-27', priority: 'high' }));
    ok(service.createNote({ title: 'Idées', content: 'Ligne 1\nLigne 2' }));
    ok(service.updateSettings({ theme: 'dark' }));
    service.saveWidgetState({ type: 'today', visible: true, x: 10, y: 20, width: 300, height: 400, alwaysOnTop: true });
    service.close();
    service = open();
    expect(service.getTask(t.id)).toMatchObject({ title: 'Persistante', priority: 'high', dueDate: '2026-10-27' });
    expect(service.listNotes()[0]).toMatchObject({ title: 'Idées', content: 'Ligne 1\nLigne 2' });
    expect(service.getSettings().theme).toBe('dark');
    expect(service.listWidgets()).toEqual([{ type: 'today', visible: true, x: 10, y: 20, width: 300, height: 400, alwaysOnTop: true }]);
  });

  it('récupère automatiquement une base corrompue depuis la dernière sauvegarde', () => {
    ok(service.createTask({ title: 'Sauvée' }));
    service.backup();
    ok(service.createTask({ title: 'Perdue (après la sauvegarde)' }));
    service.close();
    const file = path.join(dir, 'data.db');
    for (const ext of ['-wal', '-shm']) fs.rmSync(file + ext, { force: true });
    fs.writeFileSync(file, Buffer.alloc(8192, 0x42)); // fichier écrasé
    const { db, warning } = openDatabase(file, path.join(dir, 'backups'));
    expect(warning).toMatch(/restaurées depuis la sauvegarde/);
    service = new DataService(db, { backupDir: path.join(dir, 'backups'), now: () => clock });
    expect(service.listTasks().map((t) => t.title)).toEqual(['Sauvée']);
    expect(fs.readdirSync(dir).some((f) => f.startsWith('data.db.corrompu-'))).toBe(true);
  });

  it('crée une base vide si aucune sauvegarde ne permet la récupération', () => {
    service.close();
    const file = path.join(dir, 'data.db');
    for (const ext of ['-wal', '-shm']) fs.rmSync(file + ext, { force: true });
    fs.writeFileSync(file, 'pas une base sqlite');
    const { db, warning } = openDatabase(file, path.join(dir, 'aucune'));
    expect(warning).toMatch(/nouvelle base vide/);
    db.close();
    service = open();
  });

  it('fait tourner les sauvegardes quotidiennes (7 conservées)', () => {
    expect(service.dailyBackupIfNeeded()).not.toBeNull();
    expect(service.dailyBackupIfNeeded()).toBeNull(); // une seule par jour
    const backups = path.join(dir, 'backups');
    for (let i = 1; i <= 9; i++) {
      const f = path.join(backups, `mbi-2026-09-${String(i).padStart(2, '0')}.db`);
      fs.writeFileSync(f, 'x');
      fs.utimesSync(f, new Date(2026, 8, i), new Date(2026, 8, i));
    }
    service.backup();
    expect(service.listBackups().filter((b) => /mbi-\d{4}-\d{2}-\d{2}\.db$/.test(b.file))).toHaveLength(7);
  });
});

describe('tâches', () => {
  it('crée, modifie et supprime une tâche en émettant des événements', () => {
    const events: string[] = [];
    service.on('changed', (k) => events.push(k));
    const t = ok(service.createTask({ title: 'Écrire le rapport', description: 'Chapitre 2' }));
    expect(t.status).toBe('todo');
    const u = ok(service.updateTask(t.id, { status: 'in_progress', dueDate: '2026-10-30', dueTime: '17:00' }));
    expect(u).toMatchObject({ status: 'in_progress', dueTime: '17:00', description: 'Chapitre 2' });
    ok(service.deleteTask(t.id));
    expect(service.listTasks()).toHaveLength(0);
    expect(events).toEqual(['tasks', 'tasks', 'tasks']);
    expect(service.deleteTask(t.id).ok).toBe(false);
  });

  it('renvoie les erreurs de validation en français', () => {
    const r = service.createTask({ title: '', dueDate: 'demain' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toMatchObject({ title: 'Le titre est obligatoire.', dueDate: "La date d'échéance est invalide." });
    expect(service.createTask({ title: 'x', projectId: 'inexistant' }).ok).toBe(false);
    expect(service.updateTask('inexistant', { title: 'x' }).ok).toBe(false);
  });

  it("gère la date de fin lors de la complétion et de la réouverture", () => {
    const t = ok(service.createTask({ title: 'A' }));
    const done = ok(service.toggleTask(t.id));
    expect(done.status).toBe('done');
    expect(done.completedAt).toBe(clock.toISOString());
    clock = new Date(clock.getTime() + 60_000);
    const again = ok(service.updateTask(t.id, { title: 'A bis' }));
    expect(again.completedAt).toBe(done.completedAt); // inchangée si toujours terminée
    const reopened = ok(service.toggleTask(t.id));
    expect(reopened).toMatchObject({ status: 'todo', completedAt: null });
  });

  it("retire l'heure et les rappels relatifs quand la date est effacée", () => {
    const t = ok(
      service.createTask({
        title: 'A',
        dueDate: '2026-10-27',
        dueTime: '10:00',
        reminders: [{ type: 'relative', offsetMinutes: 10 }, { type: 'absolute', at: '2026-10-27T08:00' }],
      }),
    );
    const u = ok(service.updateTask(t.id, { dueDate: null }));
    expect(u.dueTime).toBeNull();
    expect(u.reminders.map((r) => r.type)).toEqual(['absolute']);
  });

  it('applique le rappel par défaut aux tâches avec heure', () => {
    const t = ok(service.createTask({ title: 'A', dueDate: '2026-10-27', dueTime: '10:00' }));
    expect(t.reminders).toMatchObject([{ type: 'relative', offsetMinutes: 15, firedAt: null }]);
    const explicit = ok(service.createTask({ title: 'B', dueDate: '2026-10-27', dueTime: '10:00', reminders: [] }));
    expect(explicit.reminders).toEqual([]);
  });

  it('crée une tâche depuis la saisie rapide (projet créé automatiquement)', () => {
    const t = ok(service.quickAdd('Appeler Paul demain 14h #Travail !urgent'));
    expect(t).toMatchObject({ title: 'Appeler Paul', dueDate: '2026-10-27', dueTime: '14:00', priority: 'urgent' });
    const project = service.listProjects()[0];
    expect(project.name).toBe('Travail');
    expect(t.projectId).toBe(project.id);
    const t2 = ok(service.quickAdd('Autre chose #travail'));
    expect(t2.projectId).toBe(project.id); // insensible à la casse
    expect(service.listProjects()).toHaveLength(1);
    // Valeurs par défaut du widget (ex. widget « Aujourd'hui »)
    const t3 = ok(service.quickAdd('Sans date explicite', { dueDate: '2026-10-26', priority: 'high' }));
    expect(t3).toMatchObject({ dueDate: '2026-10-26', priority: 'high' });
    // Heure déjà passée → demain
    const t4 = ok(service.quickAdd('Réveil 7h'));
    expect(t4).toMatchObject({ dueDate: '2026-10-27', dueTime: '07:00' });
    expect(service.quickAdd('   ').ok).toBe(false);
  });

  it('reporte une tâche et la duplique', () => {
    const late = ok(service.createTask({ title: 'En retard', dueDate: '2026-10-20' }));
    expect(ok(service.postponeTask(late.id, 1)).dueDate).toBe('2026-10-27');
    const future = ok(service.createTask({ title: 'Future', dueDate: '2026-11-10' }));
    expect(ok(service.postponeTask(future.id, 7)).dueDate).toBe('2026-11-17');
    const copy = ok(service.duplicateTask(future.id));
    expect(copy.title).toBe('Future (copie)');
    expect(copy.id).not.toBe(future.id);
  });

  it('marque les rappels déclenchés, les réarme quand l’échéance change et gère le report', () => {
    const t = ok(service.createTask({ title: 'A', dueDate: '2026-10-26', dueTime: '10:05', reminders: [{ type: 'relative', offsetMinutes: 5 }] }));
    service.markRemindersFired([{ taskId: t.id, reminderId: t.reminders[0].id }]);
    expect(service.getTask(t.id)!.reminders[0].firedAt).toBe(clock.toISOString());
    const moved = ok(service.updateTask(t.id, { dueTime: '11:00' }));
    expect(moved.reminders[0].firedAt).toBeNull();
    const snoozed = ok(service.snoozeReminder(t.id, 10));
    const snooze = snoozed.reminders.find((r) => r.snooze)!;
    expect(snooze).toMatchObject({ type: 'absolute', at: '2026-10-26T10:10', firedAt: null });
  });
});

describe('projets et notes', () => {
  it('refuse les doublons et détache les tâches d’un projet supprimé', () => {
    const p = ok(service.createProject({ name: 'Maison' }));
    expect(service.createProject({ name: 'maison' }).ok).toBe(false);
    const t = ok(service.createTask({ title: 'Peinture', projectId: p.id }));
    ok(service.updateProject(p.id, { color: '#ff0000' }));
    expect(service.listProjects()[0].color).toBe('#ff0000');
    ok(service.deleteProject(p.id));
    expect(service.getTask(t.id)!.projectId).toBeNull();
  });

  it('gère les notes', () => {
    const n = ok(service.createNote());
    ok(service.updateNote(n.id, { content: 'Texte' }));
    expect(service.listNotes()[0].content).toBe('Texte');
    ok(service.deleteNote(n.id));
    expect(service.listNotes()).toHaveLength(0);
  });
});

describe('paramètres', () => {
  it('valide et persiste les paramètres', () => {
    expect(service.updateSettings({ theme: 'nuit' }).ok).toBe(false);
    const s = ok(service.updateSettings({ accentColor: '#22C55E', upcomingDays: 14 }));
    expect(s.accentColor).toBe('#22c55e');
    expect(s.upcomingDays).toBe(14);
  });
});

describe('export / import', () => {
  it('exporte puis réimporte toutes les données (remplacement)', () => {
    const p = ok(service.createProject({ name: 'Travail' }));
    ok(service.createTask({ title: 'T1', projectId: p.id, dueDate: '2026-10-27', reminders: [{ type: 'relative', offsetMinutes: 60 }] }));
    ok(service.createTask({ title: 'T2', status: 'done' }));
    ok(service.createNote({ content: 'Note' }));
    const exported = JSON.parse(JSON.stringify(service.exportData()));

    ok(service.createTask({ title: 'À effacer' }));
    const counts = ok(service.importData(exported, 'replace'));
    expect(counts).toEqual({ tasks: 2, projects: 1, notes: 1 });
    const tasks = service.listTasks();
    expect(tasks.map((t) => t.title).sort()).toEqual(['T1', 'T2']);
    expect(tasks.find((t) => t.title === 'T1')!.projectId).toBe(p.id);
    expect(service.listBackups().some((b) => b.file.includes('avant-import'))).toBe(true);
  });

  it('fusionne sans dupliquer et ignore les entrées invalides', () => {
    ok(service.createTask({ title: 'Existante' }));
    const exported = JSON.parse(JSON.stringify(service.exportData()));
    exported.tasks.push({ title: '' }, { title: 'Nouvelle', priority: 'urgent' }, null);
    const counts = ok(service.importData(exported, 'merge'));
    expect(counts.tasks).toBe(1);
    expect(service.listTasks().map((t) => t.title).sort()).toEqual(['Existante', 'Nouvelle']);
  });

  it('refuse un fichier étranger', () => {
    expect(service.importData({ hello: 'world' }).ok).toBe(false);
    expect(service.importData(null).ok).toBe(false);
  });

  it('restaure une sauvegarde', () => {
    ok(service.createTask({ title: 'Avant' }));
    const file = service.backup();
    ok(service.createTask({ title: 'Après' }));
    ok(service.restoreBackup(file));
    expect(service.listTasks().map((t) => t.title)).toEqual(['Avant']);
    expect(service.restoreBackup('/etc/passwd').ok).toBe(false);
  });
});
