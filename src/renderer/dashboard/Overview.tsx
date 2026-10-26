// Vue d'ensemble : salutation, saisie rapide, statistiques, aujourd'hui, priorités, à venir.

import { useMemo } from 'react';
import { formatDayLabel, formatLongDate, greeting, todayKey } from '../../shared/dates';
import { computeStats, prioritiesView, todayView, upcomingView } from '../../shared/queries';
import type { AppSnapshot, Task } from '../../shared/types';
import type { DashboardRoute } from '../../shared/api';
import { Icon } from '../components/Icon';
import { TaskItem } from '../components/TaskItem';
import { QuickAddInput } from '../components/QuickAddInput';
import { WeekBars } from '../widgets/Widgets';

interface Props {
  snapshot: AppSnapshot;
  now: Date;
  onEdit: (task: Task) => void;
  navigate: (route: DashboardRoute) => void;
}

function List({ tasks, snapshot, now, onEdit, empty, showDate = true }: { tasks: Task[]; snapshot: AppSnapshot; now: Date; onEdit: (t: Task) => void; empty: string; showDate?: boolean }) {
  const projects = useMemo(() => new Map(snapshot.projects.map((p) => [p.id, p])), [snapshot.projects]);
  if (!tasks.length) return <div className="empty">{empty}</div>;
  return (
    <ul className="task-list">
      {tasks.map((t) => (
        <TaskItem key={t.id} task={t} now={now} project={t.projectId ? projects.get(t.projectId) : null} onEdit={onEdit} showDate={showDate} />
      ))}
    </ul>
  );
}

export function Overview({ snapshot, now, onEdit, navigate }: Props) {
  const today = todayKey(now);
  const stats = useMemo(() => computeStats(snapshot.tasks, now), [snapshot.tasks, now]);
  const tv = useMemo(() => todayView(snapshot.tasks, now, false), [snapshot.tasks, now]);
  const prio = useMemo(() => prioritiesView(snapshot.tasks).slice(0, 8), [snapshot.tasks]);
  const upcoming = useMemo(() => upcomingView(snapshot.tasks, now, 7), [snapshot.tasks, now]);
  const upcomingFlat = upcoming.flatMap((g) => g.tasks).slice(0, 8);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{greeting(now)}</h1>
          <p>
            {formatLongDate(today)} —{' '}
            {stats.dueToday + stats.overdue === 0
              ? "rien d'urgent aujourd'hui."
              : `${stats.dueToday} tâche${stats.dueToday > 1 ? 's' : ''} prévue${stats.dueToday > 1 ? 's' : ''} aujourd'hui${stats.overdue ? `, ${stats.overdue} en retard` : ''}.`}
          </p>
        </div>
      </div>

      {snapshot.info.storageWarning && (
        <div className="banner">
          <Icon name="alert" />
          <span>{snapshot.info.storageWarning}</span>
        </div>
      )}

      <div className="card big-add">
        <QuickAddInput now={now} placeholder="Ajouter une tâche… (ex. « Envoyer le devis vendredi 10h #Clients !haute »)" />
        <div className="syntax-hint">
          Astuce : écrivez la date (« demain », « lundi », « 15/11 »), l'heure (« 14h30 »), le projet (« #Maison ») et la priorité (« !urgent ») directement dans le titre.
        </div>
      </div>

      <div className="stats-row">
        <button type="button" className="card stat-card" onClick={() => navigate({ page: 'tasks' })}>
          <span className="ico">
            <Icon name="sun" />
          </span>
          <div>
            <strong>{stats.dueToday}</strong>
            <span>pour aujourd'hui</span>
          </div>
        </button>
        <button type="button" className={`card stat-card ${stats.overdue ? 'danger' : ''}`} onClick={() => navigate({ page: 'tasks' })}>
          <span className="ico">
            <Icon name="alert" />
          </span>
          <div>
            <strong>{stats.overdue}</strong>
            <span>en retard</span>
          </div>
        </button>
        <button type="button" className="card stat-card info" onClick={() => navigate({ page: 'tasks' })}>
          <span className="ico">
            <Icon name="play" />
          </span>
          <div>
            <strong>{stats.inProgress}</strong>
            <span>en cours</span>
          </div>
        </button>
        <button type="button" className="card stat-card success" onClick={() => navigate({ page: 'tasks' })}>
          <span className="ico">
            <Icon name="check" />
          </span>
          <div>
            <strong>{stats.doneThisWeek}</strong>
            <span>terminées en 7 jours</span>
          </div>
        </button>
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h3>
              <Icon name="sun" /> Aujourd'hui
            </h3>
            <span className="badge">{tv.overdue.length + tv.pending.length}</span>
          </div>
          <div className="card-body">
            {tv.overdue.length > 0 && <div className="widget-section danger">En retard</div>}
            <List tasks={tv.overdue} snapshot={snapshot} now={now} onEdit={onEdit} empty="" />
            {tv.overdue.length > 0 && tv.pending.length > 0 && <div className="widget-section">Prévues aujourd'hui</div>}
            <List tasks={tv.pending} snapshot={snapshot} now={now} onEdit={onEdit} showDate={false} empty={tv.overdue.length ? '' : "Aucune tâche prévue aujourd'hui."} />
          </div>
        </section>
        <section className="card">
          <div className="card-head">
            <h3>
              <Icon name="flag" /> Priorités
            </h3>
            <span className="badge">{prio.length}</span>
          </div>
          <div className="card-body">
            <List tasks={prio} snapshot={snapshot} now={now} onEdit={onEdit} empty="Aucune tâche urgente ou importante." />
          </div>
        </section>
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h3>
              <Icon name="calendar" /> À venir (7 jours)
            </h3>
          </div>
          <div className="card-body">
            {upcomingFlat.length === 0 ? (
              <div className="empty">Rien de prévu cette semaine.</div>
            ) : (
              upcoming.map((g) => (
                <div key={g.date}>
                  <div className="widget-section">{formatDayLabel(g.date, now)}</div>
                  <List tasks={g.tasks} snapshot={snapshot} now={now} onEdit={onEdit} showDate={false} empty="" />
                </div>
              ))
            )}
          </div>
        </section>
        <section className="card">
          <div className="card-head">
            <h3>
              <Icon name="chart" /> Progression
            </h3>
          </div>
          <div className="card-body" style={{ padding: '6px 18px 16px' }}>
            <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 12 }}>
              <div className="stat">
                <strong>{stats.done}</strong>
                <span>terminées</span>
              </div>
              <div className="stat">
                <strong>{stats.remaining}</strong>
                <span>restantes</span>
              </div>
              <div className="stat">
                <strong>{Math.round(stats.completionRate * 100)} %</strong>
                <span>accompli</span>
              </div>
              <div className="stat">
                <strong>{stats.streak} j</strong>
                <span>série</span>
              </div>
            </div>
            <WeekBars days={stats.last7Days} today={today} />
          </div>
        </section>
      </div>
    </div>
  );
}
