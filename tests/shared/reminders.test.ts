import { describe, expect, it } from 'vitest';
import {
  collectDueReminders,
  describeReminder,
  isDigestDue,
  nextReminderTime,
  rearmReminders,
  reminderFireTime,
  upcomingReminders,
} from '../../src/shared/reminders';
import { makeTask, NOW } from '../helpers/factory';

describe('rappels', () => {
  it("calcule le moment de déclenchement (heure par défaut si pas d'heure)", () => {
    const withTime = makeTask({ dueDate: '2026-10-26', dueTime: '14:00' });
    expect(reminderFireTime(withTime, { type: 'relative', offsetMinutes: 30 }, '09:00')).toEqual(new Date(2026, 9, 26, 13, 30));
    const noTime = makeTask({ dueDate: '2026-10-27' });
    expect(reminderFireTime(noTime, { type: 'relative', offsetMinutes: 0 }, '09:00')).toEqual(new Date(2026, 9, 27, 9, 0));
    expect(reminderFireTime(noTime, { type: 'absolute', at: '2026-10-26T18:15' }, '09:00')).toEqual(new Date(2026, 9, 26, 18, 15));
    expect(reminderFireTime(makeTask(), { type: 'relative', offsetMinutes: 0 }, '09:00')).toBeNull();
  });

  it('sépare les rappels dus des rappels trop anciens', () => {
    const tasks = [
      makeTask({ id: 'due', dueDate: '2026-10-26', dueTime: '10:00', reminders: [{ id: 'r1', type: 'relative', offsetMinutes: 5, firedAt: null }] }),
      makeTask({ id: 'old', dueDate: '2026-10-20', dueTime: '10:00', reminders: [{ id: 'r2', type: 'relative', offsetMinutes: 0, firedAt: null }] }),
      makeTask({ id: 'future', dueDate: '2026-10-26', dueTime: '12:00', reminders: [{ id: 'r3', type: 'relative', offsetMinutes: 0, firedAt: null }] }),
      makeTask({ id: 'fired', dueDate: '2026-10-26', dueTime: '09:00', reminders: [{ id: 'r4', type: 'relative', offsetMinutes: 0, firedAt: NOW.toISOString() }] }),
      makeTask({ id: 'done', status: 'done', dueDate: '2026-10-26', dueTime: '09:30', reminders: [{ id: 'r5', type: 'relative', offsetMinutes: 0, firedAt: null }] }),
    ];
    const { due, expired } = collectDueReminders(tasks, NOW, '09:00');
    expect(due.map((d) => d.task.id)).toEqual(['due']);
    expect(expired.map((d) => d.task.id)).toEqual(['old']);
    expect(nextReminderTime(tasks, NOW, '09:00')).toEqual(new Date(2026, 9, 26, 12, 0));
    expect(upcomingReminders(tasks, NOW, '09:00').map((r) => r.task.id)).toEqual(['future']);
  });

  it("réarme les rappels quand l'échéance change", () => {
    const prev = {
      dueDate: '2026-10-26',
      dueTime: '10:00',
      reminders: [
        { id: 'r1', type: 'relative' as const, offsetMinutes: 0, firedAt: '2026-10-26T08:00:00.000Z' },
        { id: 'r2', type: 'absolute' as const, at: '2026-10-25T10:00', firedAt: '2026-10-25T08:00:00.000Z' },
      ],
    };
    const same = rearmReminders(prev, { dueDate: '2026-10-26', dueTime: '10:00', reminders: prev.reminders });
    expect(same.every((r) => r.firedAt)).toBe(true);
    const moved = rearmReminders(prev, { dueDate: '2026-10-27', dueTime: '10:00', reminders: prev.reminders });
    expect(moved[0].firedAt).toBeNull();
    expect(moved[1].firedAt).not.toBeNull(); // rappel absolu inchangé
  });

  it('décrit les rappels en français', () => {
    expect(describeReminder({ type: 'relative', offsetMinutes: 60 })).toBe('1 h avant');
    expect(describeReminder({ type: 'absolute', at: '2026-11-12T08:30' }, NOW)).toMatch(/12 nov.* à 08:30/);
  });

  it('planifie le résumé quotidien une fois par jour', () => {
    expect(isDigestDue(NOW, '09:00', null)).toBe(true);
    expect(isDigestDue(NOW, '09:00', '2026-10-26')).toBe(false);
    expect(isDigestDue(NOW, '11:00', null)).toBe(false);
    expect(isDigestDue(new Date(2026, 9, 26, 18, 0), '09:00', null)).toBe(false);
  });
});
