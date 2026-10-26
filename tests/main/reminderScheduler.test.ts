import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../../src/main/storage/database';
import { DataService } from '../../src/main/services/dataService';
import { ReminderScheduler, type DigestSummary } from '../../src/main/services/reminderScheduler';
import type { FiredReminder } from '../../src/shared/types';

let dir: string;
let data: DataService;
let clock: Date;
let fired: FiredReminder[][];
let digests: DigestSummary[];
let scheduler: ReminderScheduler;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbi-sched-'));
  const { db } = openDatabase(path.join(dir, 'd.db'), null);
  clock = new Date(2026, 9, 26, 8, 0);
  data = new DataService(db, { backupDir: path.join(dir, 'b'), now: () => clock });
  fired = [];
  digests = [];
  scheduler = new ReminderScheduler(data, { onFired: (i) => fired.push(i), onDigest: (d) => digests.push(d) }, () => clock);
});

afterEach(() => {
  scheduler.stop();
  data.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('ReminderScheduler', () => {
  it('déclenche un rappel une seule fois, au bon moment', () => {
    const r = data.createTask({ title: 'Réunion', dueDate: '2026-10-26', dueTime: '09:00', reminders: [{ type: 'relative', offsetMinutes: 15 }] });
    expect(r.ok).toBe(true);
    scheduler.tick();
    expect(fired).toHaveLength(0);
    clock = new Date(2026, 9, 26, 8, 45);
    scheduler.tick();
    expect(fired).toHaveLength(1);
    expect(fired[0][0]).toMatchObject({ title: 'Réunion', dueLabel: "Aujourd'hui · 09:00" });
    scheduler.tick();
    expect(fired).toHaveLength(1);
  });

  it("n'envoie pas les rappels très anciens (PC éteint plusieurs jours) mais les marque traités", () => {
    data.createTask({ title: 'Vieux', dueDate: '2026-10-20', dueTime: '09:00', reminders: [{ type: 'relative', offsetMinutes: 0 }] });
    clock = new Date(2026, 9, 26, 7, 0);
    scheduler.tick();
    expect(fired).toHaveLength(0);
    expect(data.listTasks()[0].reminders[0].firedAt).not.toBeNull();
  });

  it('ignore les tâches terminées', () => {
    const r = data.createTask({ title: 'Faite', status: 'done', dueDate: '2026-10-26', dueTime: '08:00', reminders: [{ type: 'relative', offsetMinutes: 0 }] });
    expect(r.ok).toBe(true);
    clock = new Date(2026, 9, 26, 8, 1);
    scheduler.tick();
    expect(fired).toHaveLength(0);
  });

  it('envoie le résumé quotidien une fois par jour', () => {
    data.createTask({ title: 'Aujourd’hui', dueDate: '2026-10-26', priority: 'urgent' });
    data.createTask({ title: 'En retard', dueDate: '2026-10-24' });
    clock = new Date(2026, 9, 26, 9, 5);
    scheduler.tick();
    scheduler.tick();
    expect(digests).toHaveLength(1);
    expect(digests[0]).toMatchObject({ dueToday: 1, overdue: 1, urgent: 1 });
  });

  it('déclenche un rappel reporté', () => {
    const t = data.createTask({ title: 'Appel', dueDate: '2026-10-26', dueTime: '08:00', reminders: [{ type: 'relative', offsetMinutes: 0 }] });
    if (!t.ok) throw new Error();
    clock = new Date(2026, 9, 26, 8, 0, 30);
    scheduler.tick();
    expect(fired).toHaveLength(1);
    data.snoozeReminder(t.value.id, 10);
    clock = new Date(2026, 9, 26, 8, 11);
    scheduler.tick();
    expect(fired).toHaveLength(2);
  });
});
