// Les 8 widgets du bureau.

import { useEffect, useMemo, useRef, useState } from 'react';
import { addDays, formatDayLabel, formatRelative, formatShortDate, todayKey, weekdayShort } from '../../shared/dates';
import { describeReminder, recentFiredReminders, upcomingReminders } from '../../shared/reminders';
import {
  computeStats,
  filterTasks,
  groupByProject,
  isOverdue,
  prioritiesView,
  sortTasks,
  todayView,
  upcomingView,
} from '../../shared/queries';
import type { AppSnapshot, Project, Task, WidgetType } from '../../shared/types';
import type { QuickAddDefaults } from '../../shared/api';
import { api } from '../lib/api';
import { useNow } from '../lib/store';
import { Icon } from '../components/Icon';
import { TaskItem } from '../components/TaskItem';
import { QuickAddInput } from '../components/QuickAddInput';
import { useDebouncedCallback } from '../components/ui';
import { WidgetShell } from './WidgetShell';

interface WidgetProps {
  snapshot: AppSnapshot;
  now: Date;
}

function useProjects(projects: Project[]) {
  return useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
}

function TaskRows({ tasks, snapshot, now, showProject = true, showDate = true }: { tasks: Task[]; snapshot: AppSnapshot; now: Date; showProject?: boolean; showDate?: boolean }) {
  const projects = useProjects(snapshot.projects);
  return (
    <ul className="task-list">
      {tasks.map((t) => (
        <TaskItem
          key={t.id}
          task={t}
          now={now}
          project={t.projectId ? projects.get(t.projectId) : null}
          showProject={showProject}
          showDate={showDate}
        />
      ))}
    </ul>
  );
}

function Empty({ icon, title, text }: { icon: string; title: string; text?: string }) {
  return (
    <div className="empty">
      <Icon name={icon} />
      <strong>{title}</strong>
      {text && <span>{text}</span>}
    </div>
  );
}

/** Pied de widget avec saisie rapide, focalisable via le bouton « + » de l'en-tête. */
function useAddFooter(now: Date, defaults?: QuickAddDefaults, placeholder?: string) {
  const ref = useRef<HTMLInputElement>(null);
  const footer = <QuickAddInput now={now} defaults={defaults} inputRef={ref} placeholder={placeholder} />;
  return { footer, focus: () => ref.current?.focus() };
}

// ------------------------------------------------------------------ Aujourd'hui

function TodayWidget({ snapshot, now }: WidgetProps) {
  const today = todayKey(now);
  const view = useMemo(() => todayView(snapshot.tasks, now, snapshot.settings.showCompletedInWidgets), [snapshot.tasks, now, snapshot.settings.showCompletedInWidgets]);
  const [showDone, setShowDone] = useState(false);
  const { footer, focus } = useAddFooter(now, { dueDate: today }, "Ajouter pour aujourd'hui…");
  const open = view.overdue.length + view.pending.length;
  return (
    <WidgetShell type="today" snapshot={snapshot} count={open || undefined} onAdd={focus} footer={footer}>
      {view.overdue.length > 0 && (
        <>
          <div className="widget-section danger">
            <Icon name="alert" size={11} /> En retard · {view.overdue.length}
            <button type="button" title="Reporter toutes les tâches en retard à aujourd'hui" onClick={() => view.overdue.forEach((t) => void api.tasks.update(t.id, { dueDate: today }))}>
              Tout à aujourd'hui
            </button>
          </div>
          <TaskRows tasks={view.overdue} snapshot={snapshot} now={now} />
        </>
      )}
      {view.overdue.length > 0 && view.pending.length > 0 && <div className="widget-section">Aujourd'hui · {view.pending.length}</div>}
      <TaskRows tasks={view.pending} snapshot={snapshot} now={now} showDate={false} />
      {open === 0 && <Empty icon="sparkles" title="Journée libre !" text="Aucune tâche prévue aujourd'hui." />}
      {view.done.length > 0 && (
        <>
          <div className="widget-section">
            Terminées · {view.done.length}
            <button type="button" onClick={() => setShowDone((v) => !v)}>
              {showDone ? 'Masquer' : 'Afficher'}
            </button>
          </div>
          {showDone && <TaskRows tasks={view.done} snapshot={snapshot} now={now} showDate={false} />}
        </>
      )}
    </WidgetShell>
  );
}

// ------------------------------------------------------------------ À venir

function UpcomingWidget({ snapshot, now }: WidgetProps) {
  const days = snapshot.settings.upcomingDays;
  const groups = useMemo(() => upcomingView(snapshot.tasks, now, days), [snapshot.tasks, now, days]);
  const total = groups.reduce((n, g) => n + g.tasks.length, 0);
  const { footer, focus } = useAddFooter(now, { dueDate: addDays(todayKey(now), 1) }, 'Ajouter pour demain…');
  return (
    <WidgetShell type="upcoming" snapshot={snapshot} count={total || undefined} onAdd={focus} footer={footer}>
      {groups.map((g) => (
        <div key={g.date}>
          <div className="widget-section">
            {formatDayLabel(g.date, now)}
            <span style={{ fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>{formatShortDate(g.date, now)}</span>
          </div>
          <TaskRows tasks={g.tasks} snapshot={snapshot} now={now} showDate={false} />
        </div>
      ))}
      {total === 0 && <Empty icon="calendar" title="Rien à l'horizon" text={`Aucune tâche dans les ${days} prochains jours.`} />}
    </WidgetShell>
  );
}

// ------------------------------------------------------------------ Priorités

function PrioritiesWidget({ snapshot, now }: WidgetProps) {
  const tasks = useMemo(() => prioritiesView(snapshot.tasks), [snapshot.tasks]);
  const urgent = tasks.filter((t) => t.priority === 'urgent');
  const high = tasks.filter((t) => t.priority === 'high');
  const { footer, focus } = useAddFooter(now, { priority: 'high' }, 'Ajouter une priorité… (!urgent)');
  return (
    <WidgetShell type="priorities" snapshot={snapshot} count={tasks.length || undefined} onAdd={focus} footer={footer}>
      {urgent.length > 0 && (
        <>
          <div className="widget-section danger">Urgentes · {urgent.length}</div>
          <TaskRows tasks={urgent} snapshot={snapshot} now={now} />
        </>
      )}
      {high.length > 0 && (
        <>
          <div className="widget-section">Élevées · {high.length}</div>
          <TaskRows tasks={high} snapshot={snapshot} now={now} />
        </>
      )}
      {tasks.length === 0 && <Empty icon="flag" title="Aucune urgence" text="Les tâches de priorité élevée ou urgente apparaîtront ici." />}
    </WidgetShell>
  );
}

// ------------------------------------------------------------------ Mes tâches

type TaskTab = 'open' | 'in_progress' | 'done' | 'all';

function TasksWidget({ snapshot, now }: WidgetProps) {
  const [tab, setTab] = useState<TaskTab>('open');
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const tasks = useMemo(
    () => sortTasks(filterTasks(snapshot.tasks, { status: tab, search }, snapshot.projects, now)),
    [snapshot.tasks, snapshot.projects, tab, search, now],
  );
  const openCount = snapshot.tasks.filter((t) => t.status !== 'done').length;
  const { footer, focus } = useAddFooter(now);
  const tabs: { id: TaskTab; label: string }[] = [
    { id: 'open', label: 'À faire' },
    { id: 'in_progress', label: 'En cours' },
    { id: 'done', label: 'Terminées' },
    { id: 'all', label: 'Toutes' },
  ];
  return (
    <WidgetShell
      type="tasks"
      snapshot={snapshot}
      count={openCount || undefined}
      onAdd={focus}
      footer={footer}
      toolbar={
        <>
          <div className="mini-tabs">
            {tabs.map((t) => (
              <button type="button" key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
            <button type="button" className={searching ? 'on' : ''} title="Rechercher" onClick={() => { setSearching((v) => !v); setSearch(''); }} style={{ marginLeft: 'auto' }}>
              <Icon name="search" size={12} />
            </button>
          </div>
          {searching && (
            <input
              className="input widget-search"
              autoFocus
              placeholder="Rechercher…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setSearch('');
                  setSearching(false);
                }
              }}
            />
          )}
        </>
      }
    >
      <TaskRows tasks={tasks} snapshot={snapshot} now={now} />
      {tasks.length === 0 && (
        <Empty
          icon={search ? 'search' : 'check'}
          title={search ? 'Aucun résultat' : tab === 'done' ? 'Aucune tâche terminée' : 'Tout est fait !'}
          text={search ? 'Essayez un autre mot-clé.' : undefined}
        />
      )}
    </WidgetShell>
  );
}

// ------------------------------------------------------------------ Projets

function ProjectsWidget({ snapshot, now }: WidgetProps) {
  const groups = useMemo(() => groupByProject(snapshot.tasks, snapshot.projects), [snapshot.tasks, snapshot.projects]);
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const toggle = (key: string) =>
    setClosed((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  return (
    <WidgetShell
      type="projects"
      snapshot={snapshot}
      count={snapshot.projects.length || undefined}
      onAdd={() => api.app.openDashboard({ page: 'projects' })}
      addTitle="Gérer les projets"
    >
      {groups.map((g) => {
        const key = g.project?.id ?? 'none';
        const open = !closed.has(key);
        const ratio = g.total ? g.done / g.total : 0;
        return (
          <div className="project-group" key={key}>
            <button type="button" className={`project-head ${open ? 'open' : ''}`} onClick={() => toggle(key)}>
              <span className="chev">
                <Icon name="chevronRight" />
              </span>
              <span className="dot" style={{ background: g.project?.color ?? 'var(--text-3)' }} />
              <span className="name">{g.project?.name ?? 'Sans projet'}</span>
              <span className="count">
                {g.done}/{g.total}
              </span>
              <span className="progress-bar" title={`${Math.round(ratio * 100)} % terminé`}>
                <span style={{ width: `${ratio * 100}%`, background: g.project?.color }} />
              </span>
              <span
                className="icon-btn sm no-drag"
                role="button"
                tabIndex={0}
                title="Ajouter une tâche à ce projet"
                onClick={(e) => {
                  e.stopPropagation();
                  setAddingTo(addingTo === key ? null : key);
                }}
              >
                <Icon name="plus" />
              </span>
            </button>
            {open && (
              <div className="project-tasks">
                {addingTo === key && (
                  <div style={{ padding: '2px 4px 4px' }}>
                    <QuickAddInput now={now} autoFocus defaults={{ projectId: g.project?.id ?? null }} placeholder={`Ajouter à ${g.project?.name ?? 'Sans projet'}…`} />
                  </div>
                )}
                <TaskRows tasks={g.tasks} snapshot={snapshot} now={now} showProject={false} />
                {g.tasks.length === 0 && addingTo !== key && (
                  <div className="field-hint" style={{ padding: '2px 10px 6px' }}>
                    {g.total ? 'Toutes les tâches sont terminées.' : 'Aucune tâche.'}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
      {groups.length === 0 && <Empty icon="folder" title="Aucun projet" text="Tapez #NomDuProjet dans une tâche pour en créer un." />}
    </WidgetShell>
  );
}

// ------------------------------------------------------------------ Notes rapides

function NotesWidget({ snapshot }: WidgetProps) {
  const notes = snapshot.notes;
  const [activeId, setActiveId] = useState<string | null>(notes[0]?.id ?? null);
  const active = notes.find((n) => n.id === activeId) ?? notes[0] ?? null;
  const [draft, setDraft] = useState(active?.content ?? '');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const editingId = useRef<string | null>(active?.id ?? null);

  // Synchronise le brouillon quand on change de note ou quand la note est modifiée ailleurs.
  useEffect(() => {
    if (!active) {
      setDraft('');
      editingId.current = null;
      return;
    }
    if (editingId.current !== active.id || (status !== 'saving' && document.activeElement?.tagName !== 'TEXTAREA')) {
      setDraft(active.content);
      editingId.current = active.id;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, active?.content]);

  const save = useDebouncedCallback(async (id: string, content: string) => {
    const r = await api.notes.update(id, { content });
    setStatus(r.ok ? 'saved' : 'idle');
  }, 450);

  const createNote = async () => {
    save.flush();
    const r = await api.notes.create({ title: `Note ${notes.length + 1}` });
    if (r.ok) setActiveId(r.value.id);
  };

  return (
    <WidgetShell type="notes" snapshot={snapshot} onAdd={createNote} addTitle="Nouvelle note">
      <div className="notes-widget">
        {notes.length > 1 && (
          <div className="note-tabs">
            {notes.map((n) => (
              <button
                type="button"
                key={n.id}
                className={`note-tab ${active?.id === n.id ? 'on' : ''}`}
                onClick={() => {
                  save.flush();
                  setActiveId(n.id);
                }}
                onDoubleClick={() => api.app.openDashboard({ page: 'notes', noteId: n.id })}
                title={`${n.title || 'Sans titre'} — double-cliquez pour ouvrir dans le tableau de bord`}
              >
                {n.title || 'Sans titre'}
              </button>
            ))}
          </div>
        )}
        {active ? (
          <textarea
            className="note-area"
            value={draft}
            placeholder="Écrivez ici… (enregistrement automatique)"
            spellCheck
            onChange={(e) => {
              setDraft(e.target.value);
              setStatus('saving');
              save.call(active.id, e.target.value);
            }}
            onBlur={() => save.flush()}
          />
        ) : (
          <button type="button" className="empty" style={{ border: 'none', background: 'none', flex: 1 }} onClick={createNote}>
            <Icon name="note" />
            <strong>Aucune note</strong>
            <span>Cliquez pour créer votre première note.</span>
          </button>
        )}
        {status !== 'idle' && <span className="note-status">{status === 'saving' ? 'Enregistrement…' : 'Enregistré'}</span>}
      </div>
    </WidgetShell>
  );
}

// ------------------------------------------------------------------ Rappels

function RemindersWidget({ snapshot, now }: WidgetProps) {
  const settings = snapshot.settings;
  const recent = useMemo(() => recentFiredReminders(snapshot.tasks, now, 12), [snapshot.tasks, now]);
  const upcoming = useMemo(() => upcomingReminders(snapshot.tasks, now, settings.defaultReminderTime, 24 * 7).slice(0, 12), [snapshot.tasks, now, settings.defaultReminderTime]);
  const overdue = useMemo(() => snapshot.tasks.filter((t) => isOverdue(t, now)).length, [snapshot.tasks, now]);
  const notificationsOn = settings.nativeNotifications || settings.reminderPopup;
  return (
    <WidgetShell type="reminders" snapshot={snapshot} count={upcoming.length || undefined} onAdd={() => api.app.openQuickAdd()}>
      {!notificationsOn && (
        <div className="widget-section danger">
          <Icon name="bellOff" size={11} /> Notifications désactivées
          <button type="button" onClick={() => void api.settings.update({ nativeNotifications: true, reminderPopup: true })}>
            Activer
          </button>
        </div>
      )}
      {recent.length > 0 && (
        <>
          <div className="widget-section">Récents</div>
          {recent.map((r) => (
            <div className="reminder-row fired" key={`${r.task.id}-${r.reminder.id}`}>
              <span className="bell">
                <Icon name="bell" />
              </span>
              <div className="task-main">
                <span className="task-title">{r.task.title}</span>
                <span className="when">{formatRelative(r.fireAt, now)}</span>
              </div>
              <div className="actions">
                <button type="button" className="icon-btn sm" title={`Reporter de ${settings.snoozeMinutes} min`} onClick={() => void api.tasks.snooze(r.task.id, settings.snoozeMinutes)}>
                  <Icon name="clock" />
                </button>
                <button type="button" className="icon-btn sm" title="Terminer" onClick={() => void api.tasks.setStatus(r.task.id, 'done')}>
                  <Icon name="check" />
                </button>
              </div>
            </div>
          ))}
        </>
      )}
      <div className="widget-section">
        À venir
        {overdue > 0 && (
          <button type="button" style={{ color: 'var(--danger)' }} onClick={() => api.app.openDashboard({ page: 'tasks' })}>
            {overdue} en retard
          </button>
        )}
      </div>
      {upcoming.map((r) => (
        <div className="reminder-row" key={`${r.task.id}-${r.reminder.id}`} onDoubleClick={() => api.app.openDashboard({ page: 'tasks', editTaskId: r.task.id })}>
          <span className="bell">
            <Icon name={r.reminder.snooze ? 'repeat' : 'bell'} />
          </span>
          <div className="task-main">
            <span className="task-title">{r.task.title}</span>
            <span className="when">
              {formatRelative(r.fireAt, now)} · {r.reminder.type === 'relative' ? describeReminder(r.reminder, now) : `${formatDayLabel(todayKey(r.fireAt), now)} ${r.fireAt.toTimeString().slice(0, 5)}`}
            </span>
          </div>
        </div>
      ))}
      {upcoming.length === 0 && <Empty icon="bell" title="Aucun rappel prévu" text="Ajoutez une heure à une tâche pour être prévenu." />}
    </WidgetShell>
  );
}

// ------------------------------------------------------------------ Progression

function Ring({ value, label, sub }: { value: number; label: string; sub: string }) {
  const r = 32;
  const c = 2 * Math.PI * r;
  return (
    <div className="ring" role="img" aria-label={`${label} ${sub}`}>
      <svg viewBox="0 0 74 74">
        <circle className="bg" cx="37" cy="37" r={r} />
        <circle className="fg" cx="37" cy="37" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, value))} />
      </svg>
      <div className="label">
        <strong>{label}</strong>
        <small>{sub}</small>
      </div>
    </div>
  );
}

export function WeekBars({ days, today }: { days: { date: string; count: number }[]; today: string }) {
  const max = Math.max(1, ...days.map((d) => d.count));
  return (
    <div className="bars" aria-label="Tâches terminées sur 7 jours">
      {days.map((d) => (
        <div key={d.date} className={`bar ${d.date === today ? 'today' : ''}`} title={`${d.count} terminée${d.count > 1 ? 's' : ''} — ${formatShortDate(d.date)}`}>
          <span style={{ height: `${(d.count / max) * 100}%` }} />
          <small>{weekdayShort(d.date).slice(0, 3)}</small>
        </div>
      ))}
    </div>
  );
}

function ProgressWidget({ snapshot, now }: WidgetProps) {
  const stats = useMemo(() => computeStats(snapshot.tasks, now), [snapshot.tasks, now]);
  const todayTotal = stats.doneToday + stats.remainingToday;
  return (
    <WidgetShell type="progress" snapshot={snapshot}>
      <div className="progress-widget">
        <div className="progress-top">
          <Ring value={stats.todayRate} label={`${Math.round(stats.todayRate * 100)} %`} sub={`${stats.doneToday}/${todayTotal} auj.`} />
          <div className="stat-grid">
            <div className="stat">
              <strong>{stats.remaining}</strong>
              <span>restantes</span>
            </div>
            <div className="stat">
              <strong>{stats.doneThisWeek}</strong>
              <span>terminées (7 j)</span>
            </div>
            <div className={`stat ${stats.overdue ? 'danger' : ''}`}>
              <strong>{stats.overdue}</strong>
              <span>en retard</span>
            </div>
            <div className="stat">
              <strong>{stats.inProgress}</strong>
              <span>en cours</span>
            </div>
          </div>
        </div>
        <WeekBars days={stats.last7Days} today={todayKey(now)} />
        <span className="streak">
          <Icon name="flame" filled />
          {stats.streak > 0 ? `Série de ${stats.streak} jour${stats.streak > 1 ? 's' : ''}` : 'Terminez une tâche pour lancer une série'}
          <span style={{ marginLeft: 'auto', color: 'var(--text-3)' }}>{Math.round(stats.completionRate * 100)} % au total</span>
        </span>
      </div>
    </WidgetShell>
  );
}

// ------------------------------------------------------------------ Routage

const WIDGETS: Record<WidgetType, (p: WidgetProps) => React.JSX.Element> = {
  today: TodayWidget,
  upcoming: UpcomingWidget,
  priorities: PrioritiesWidget,
  tasks: TasksWidget,
  projects: ProjectsWidget,
  notes: NotesWidget,
  reminders: RemindersWidget,
  progress: ProgressWidget,
};

export function WidgetView({ type, snapshot }: { type: WidgetType; snapshot: AppSnapshot }) {
  const now = useNow();
  const Component = WIDGETS[type];
  return <Component snapshot={snapshot} now={now} />;
}
