import { describe, expect, it } from 'vitest';
import {
  computeStats,
  filterTasks,
  groupByProject,
  isOverdue,
  prioritiesView,
  sortTasks,
  todayView,
  upcomingView,
} from '../../src/shared/queries';
import type { Project } from '../../src/shared/types';
import { makeTask, NOW } from '../helpers/factory';

const iso = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString();

describe('requêtes des widgets', () => {
  it("détecte les retards, y compris l'heure dépassée aujourd'hui", () => {
    expect(isOverdue(makeTask({ dueDate: '2026-10-25' }), NOW)).toBe(true);
    expect(isOverdue(makeTask({ dueDate: '2026-10-26', dueTime: '09:00' }), NOW)).toBe(true);
    expect(isOverdue(makeTask({ dueDate: '2026-10-26', dueTime: '11:00' }), NOW)).toBe(false);
    expect(isOverdue(makeTask({ dueDate: '2026-10-26' }), NOW)).toBe(false);
    expect(isOverdue(makeTask({ dueDate: '2026-10-20', status: 'done' }), NOW)).toBe(false);
  });

  it("construit la vue Aujourd'hui", () => {
    const tasks = [
      makeTask({ id: 'late', dueDate: '2026-10-24' }),
      makeTask({ id: 'today', dueDate: '2026-10-26' }),
      makeTask({ id: 'tomorrow', dueDate: '2026-10-27' }),
      makeTask({ id: 'doneToday', status: 'done', completedAt: iso(2026, 10, 26, 9) }),
      makeTask({ id: 'doneOld', status: 'done', dueDate: '2026-10-20', completedAt: iso(2026, 10, 20) }),
    ];
    const v = todayView(tasks, NOW);
    expect(v.overdue.map((t) => t.id)).toEqual(['late']);
    expect(v.pending.map((t) => t.id)).toEqual(['today']);
    expect(v.done.map((t) => t.id)).toEqual(['doneToday']);
    expect(todayView(tasks, NOW, false).done).toEqual([]);
  });

  it('construit la vue À venir groupée par jour', () => {
    const tasks = [
      makeTask({ id: 'a', dueDate: '2026-10-28' }),
      makeTask({ id: 'b', dueDate: '2026-10-27', dueTime: '15:00' }),
      makeTask({ id: 'c', dueDate: '2026-10-27', dueTime: '09:00' }),
      makeTask({ id: 'far', dueDate: '2026-11-20' }),
      makeTask({ id: 'today', dueDate: '2026-10-26' }),
    ];
    const v = upcomingView(tasks, NOW, 7);
    expect(v.map((g) => g.date)).toEqual(['2026-10-27', '2026-10-28']);
    expect(v[0].tasks.map((t) => t.id)).toEqual(['c', 'b']);
    expect(upcomingView(tasks, NOW, 30).map((g) => g.date)).toContain('2026-11-20');
  });

  it('liste les priorités urgentes puis élevées', () => {
    const tasks = [
      makeTask({ id: 'h', priority: 'high' }),
      makeTask({ id: 'u', priority: 'urgent' }),
      makeTask({ id: 'n', priority: 'normal' }),
      makeTask({ id: 'ud', priority: 'urgent', status: 'done' }),
    ];
    expect(prioritiesView(tasks).map((t) => t.id)).toEqual(['u', 'h']);
  });

  it('regroupe par projet avec « Sans projet » en dernier', () => {
    const projects: Project[] = [
      { id: 'p2', name: 'Perso', color: '#000000', sortOrder: 2, createdAt: '' },
      { id: 'p1', name: 'Travail', color: '#000000', sortOrder: 1, createdAt: '' },
    ];
    const tasks = [
      makeTask({ projectId: 'p1' }),
      makeTask({ projectId: 'p1', status: 'done', completedAt: iso(2026, 10, 25) }),
      makeTask({ projectId: null }),
      makeTask({ projectId: 'supprimé' }),
    ];
    const groups = groupByProject(tasks, projects);
    expect(groups.map((g) => g.project?.name ?? null)).toEqual(['Travail', 'Perso', null]);
    expect(groups[0]).toMatchObject({ total: 2, done: 1 });
    expect(groups[0].tasks).toHaveLength(1);
    expect(groups[2].tasks).toHaveLength(2);
  });

  it('trie : en cours, puis échéance, puis priorité, terminées à la fin', () => {
    const tasks = [
      makeTask({ id: 'done', status: 'done', completedAt: iso(2026, 10, 25) }),
      makeTask({ id: 'nodate' }),
      makeTask({ id: 'later', dueDate: '2026-10-30' }),
      makeTask({ id: 'soonLow', dueDate: '2026-10-27', priority: 'low' }),
      makeTask({ id: 'soonUrgent', dueDate: '2026-10-27', priority: 'urgent' }),
      makeTask({ id: 'progress', status: 'in_progress', dueDate: '2026-11-30' }),
    ];
    expect(sortTasks(tasks).map((t) => t.id)).toEqual(['progress', 'soonUrgent', 'soonLow', 'later', 'nodate', 'done']);
    expect(sortTasks(tasks, 'title')[0].title.startsWith('Tâche')).toBe(true);
  });
});

describe('filterTasks', () => {
  const projects: Project[] = [{ id: 'p1', name: 'École', color: '#000000', sortOrder: 0, createdAt: '' }];
  const tasks = [
    makeTask({ id: 'a', title: 'Réviser les maths', projectId: 'p1', dueDate: '2026-10-26' }),
    makeTask({ id: 'b', title: 'Acheter un cadeau', description: 'Pour Élodie', priority: 'high', dueDate: '2026-10-29' }),
    makeTask({ id: 'c', title: 'Ancienne', status: 'done', dueDate: '2026-10-01' }),
    makeTask({ id: 'd', title: 'Sans date', status: 'in_progress' }),
    makeTask({ id: 'e', title: 'Retard', dueDate: '2026-10-20' }),
  ];
  const ids = (f: Parameters<typeof filterTasks>[1]) => filterTasks(tasks, f, projects, NOW).map((t) => t.id);

  it('recherche sans tenir compte des accents ni de la casse', () => {
    expect(ids({ search: 'reviser' })).toEqual(['a']);
    expect(ids({ search: 'elodie' })).toEqual(['b']);
    expect(ids({ search: 'ecole' })).toEqual(['a']);
    expect(ids({ search: 'acheter cadeau' })).toEqual(['b']);
  });

  it('filtre par statut, priorité, projet et échéance', () => {
    expect(ids({ status: 'open' })).toEqual(['a', 'b', 'd', 'e']);
    expect(ids({ status: 'in_progress' })).toEqual(['d']);
    expect(ids({ priority: 'high' })).toEqual(['b']);
    expect(ids({ projectId: 'p1' })).toEqual(['a']);
    expect(ids({ projectId: 'none' })).toEqual(['b', 'c', 'd', 'e']);
    expect(ids({ due: 'overdue' })).toEqual(['e']);
    expect(ids({ due: 'today' })).toEqual(['a']);
    expect(ids({ due: 'week' })).toEqual(['a', 'b']);
    expect(ids({ due: 'nodate' })).toEqual(['d']);
  });
});

describe('computeStats', () => {
  it('calcule les statistiques et la série de jours', () => {
    const tasks = [
      makeTask({ status: 'done', completedAt: iso(2026, 10, 26, 9) }),
      makeTask({ status: 'done', completedAt: iso(2026, 10, 25) }),
      makeTask({ status: 'done', completedAt: iso(2026, 10, 24) }),
      makeTask({ status: 'done', completedAt: iso(2026, 10, 20) }),
      makeTask({ dueDate: '2026-10-26', priority: 'urgent' }),
      makeTask({ dueDate: '2026-10-22' }),
      makeTask({ status: 'in_progress' }),
    ];
    const s = computeStats(tasks, NOW);
    expect(s.total).toBe(7);
    expect(s.done).toBe(4);
    expect(s.remaining).toBe(3);
    expect(s.inProgress).toBe(1);
    expect(s.overdue).toBe(1);
    expect(s.dueToday).toBe(1);
    expect(s.doneToday).toBe(1);
    expect(s.doneThisWeek).toBe(4);
    expect(s.streak).toBe(3);
    expect(s.todayRate).toBeCloseTo(1 / 3);
    expect(s.last7Days).toHaveLength(7);
    expect(s.last7Days[6]).toEqual({ date: '2026-10-26', count: 1 });
    expect(s.byPriority.urgent).toBe(1);
  });

  it('gère une liste vide', () => {
    const s = computeStats([], NOW);
    expect(s.completionRate).toBe(0);
    expect(s.todayRate).toBe(0);
    expect(s.streak).toBe(0);
  });
});
