// Liste complète des tâches : recherche, filtres, tri, vue liste ou tableau (glisser-déposer).

import { useMemo, useState } from 'react';
import { PRIORITY_LABELS, STATUS_LABELS } from '../../shared/defaults';
import { filterTasks, sortTasks, type DueFilter, type SortKey, type TaskFilter } from '../../shared/queries';
import type { AppSnapshot, Priority, Task, TaskStatus } from '../../shared/types';
import { api } from '../lib/api';
import { Icon } from '../components/Icon';
import { TaskItem } from '../components/TaskItem';
import { Segmented, reportResult } from '../components/ui';

interface Props {
  snapshot: AppSnapshot;
  now: Date;
  search: string;
  setSearch: (s: string) => void;
  projectFilter: string;
  setProjectFilter: (p: string) => void;
  onEdit: (task: Task) => void;
  onNew: () => void;
}

const STATUS_COLORS: Record<TaskStatus, string> = { todo: 'var(--p-low)', in_progress: 'var(--info)', done: 'var(--success)' };

export function TasksPage({ snapshot, now, search, setSearch, projectFilter, setProjectFilter, onEdit, onNew }: Props) {
  const [status, setStatus] = useState<TaskFilter['status']>('open');
  const [priority, setPriority] = useState<Priority | 'all'>('all');
  const [due, setDue] = useState<DueFilter>('all');
  const [sort, setSort] = useState<SortKey>('smart');
  const [view, setView] = useState<'list' | 'board'>(() => (localStorage.getItem('mbi.tasksView') === 'board' ? 'board' : 'list'));
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropCol, setDropCol] = useState<TaskStatus | null>(null);

  const projects = useMemo(() => new Map(snapshot.projects.map((p) => [p.id, p])), [snapshot.projects]);
  const filtered = useMemo(
    () =>
      sortTasks(
        filterTasks(
          snapshot.tasks,
          { search, status: view === 'board' ? 'all' : status, priority, projectId: projectFilter as TaskFilter['projectId'], due },
          snapshot.projects,
          now,
        ),
        sort,
      ),
    [snapshot.tasks, snapshot.projects, search, status, priority, projectFilter, due, sort, view, now],
  );

  const changeView = (v: 'list' | 'board') => {
    setView(v);
    try {
      localStorage.setItem('mbi.tasksView', v);
    } catch {
      /* stockage indisponible */
    }
  };
  const resetFilters = () => {
    setStatus('open');
    setPriority('all');
    setDue('all');
    setProjectFilter('all');
    setSearch('');
  };
  const filtersActive = priority !== 'all' || due !== 'all' || projectFilter !== 'all' || !!search || (view === 'list' && status !== 'open');

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Tâches</h1>
          <p>Créez, filtrez et organisez toutes vos tâches.</p>
        </div>
        <span className="spacer" />
        <Segmented
          value={view}
          onChange={changeView}
          ariaLabel="Affichage"
          options={[
            { value: 'list', label: <><Icon name="list" size={14} /> Liste</> },
            { value: 'board', label: <><Icon name="board" size={14} /> Tableau</> },
          ]}
        />
        <button type="button" className="btn btn-primary" onClick={onNew}>
          <Icon name="plus" /> Nouvelle tâche
        </button>
      </div>

      <div className="toolbar">
        <div className="search">
          <Icon name="search" />
          <input className="input" placeholder="Rechercher (titre, description, projet)…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {view === 'list' && (
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value as TaskFilter['status'])} aria-label="Statut">
            <option value="open">Non terminées</option>
            <option value="todo">À faire</option>
            <option value="in_progress">En cours</option>
            <option value="done">Terminées</option>
            <option value="all">Tous les statuts</option>
          </select>
        )}
        <select className="select" value={priority} onChange={(e) => setPriority(e.target.value as Priority | 'all')} aria-label="Priorité">
          <option value="all">Toutes priorités</option>
          {(['urgent', 'high', 'normal', 'low'] as Priority[]).map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABELS[p]}
            </option>
          ))}
        </select>
        <select className="select" value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} aria-label="Projet">
          <option value="all">Tous les projets</option>
          <option value="none">Sans projet</option>
          {snapshot.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select className="select" value={due} onChange={(e) => setDue(e.target.value as DueFilter)} aria-label="Échéance">
          <option value="all">Toutes échéances</option>
          <option value="overdue">En retard</option>
          <option value="today">Aujourd'hui</option>
          <option value="week">7 prochains jours</option>
          <option value="upcoming">À venir</option>
          <option value="nodate">Sans échéance</option>
        </select>
        <select className="select" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Tri">
          <option value="smart">Tri intelligent</option>
          <option value="due">Par échéance</option>
          <option value="priority">Par priorité</option>
          <option value="created">Plus récentes</option>
          <option value="title">Par titre (A→Z)</option>
        </select>
        {filtersActive && (
          <button type="button" className="btn btn-ghost" onClick={resetFilters}>
            Réinitialiser
          </button>
        )}
      </div>

      {view === 'list' ? (
        <>
          <div className="result-count">
            {filtered.length} tâche{filtered.length > 1 ? 's' : ''}
          </div>
          <div className="card list-card">
            {filtered.length ? (
              <ul className="task-list">
                {filtered.map((t) => (
                  <TaskItem key={t.id} task={t} now={now} project={t.projectId ? projects.get(t.projectId) : null} variant="list" showDescription onEdit={onEdit} />
                ))}
              </ul>
            ) : (
              <div className="empty" style={{ padding: 40 }}>
                <Icon name={search ? 'search' : 'check'} />
                <strong>{search || filtersActive ? 'Aucune tâche ne correspond' : 'Aucune tâche'}</strong>
                <span>{search || filtersActive ? 'Modifiez les filtres ou la recherche.' : 'Créez votre première tâche avec le bouton « Nouvelle tâche ».'}</span>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="board">
          {(['todo', 'in_progress', 'done'] as TaskStatus[]).map((col) => {
            const tasks = filtered.filter((t) => t.status === col);
            return (
              <div
                key={col}
                className={`board-col ${dropCol === col ? 'drop' : ''}`}
                onDragOver={(e) => {
                  if (!dragId) return;
                  e.preventDefault();
                  setDropCol(col);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropCol(null);
                }}
                onDrop={async (e) => {
                  e.preventDefault();
                  setDropCol(null);
                  const id = dragId;
                  setDragId(null);
                  if (id) reportResult(await api.tasks.setStatus(id, col));
                }}
              >
                <div className="board-col-head">
                  <span className="dot" style={{ background: STATUS_COLORS[col] }} />
                  {STATUS_LABELS[col]}
                  <span className="badge">{tasks.length}</span>
                </div>
                <div className="board-cards">
                  {tasks.map((t) => (
                    <div
                      key={t.id}
                      className={`board-card ${dragId === t.id ? 'dragging' : ''}`}
                      draggable
                      onDragStart={(e) => {
                        setDragId(t.id);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setDropCol(null);
                      }}
                    >
                      <ul className="task-list">
                        <TaskItem task={t} now={now} project={t.projectId ? projects.get(t.projectId) : null} variant="list" onEdit={onEdit} />
                      </ul>
                    </div>
                  ))}
                  {!tasks.length && <div className="field-hint" style={{ padding: '6px 4px' }}>Glissez une tâche ici</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
