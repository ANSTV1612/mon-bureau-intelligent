// Tableau de bord : barre de titre, navigation, pages et éditeur de tâche.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DashboardPage, DashboardRoute } from '../../shared/api';
import { isOverdue } from '../../shared/queries';
import type { AppSnapshot, Task } from '../../shared/types';
import { todayKey } from '../../shared/dates';
import { api } from '../lib/api';
import { useNow } from '../lib/store';
import { Icon, Logo } from '../components/Icon';
import { Toasts } from '../components/ui';
import { Overview } from './Overview';
import { TasksPage } from './TasksPage';
import { ProjectsPage } from './ProjectsPage';
import { NotesPage } from './NotesPage';
import { WidgetsPage } from './WidgetsPage';
import { SettingsPage } from './SettingsPage';
import { TaskEditor } from './TaskEditor';

const NAV: { page: DashboardPage; label: string; icon: string }[] = [
  { page: 'overview', label: "Vue d'ensemble", icon: 'home' },
  { page: 'tasks', label: 'Tâches', icon: 'list' },
  { page: 'projects', label: 'Projets', icon: 'folder' },
  { page: 'notes', label: 'Notes', icon: 'note' },
  { page: 'widgets', label: 'Widgets du bureau', icon: 'grid' },
];

type EditorState = { task: Task | null; initial?: DashboardRoute['newTask'] } | null;

export function Dashboard({ snapshot }: { snapshot: AppSnapshot }) {
  const now = useNow();
  const [page, setPage] = useState<DashboardPage>('overview');
  const [editor, setEditor] = useState<EditorState>(null);
  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState('all');
  const [noteId, setNoteId] = useState<string | undefined>(undefined);
  const searchRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLElement>(null);
  const snapRef = useRef(snapshot);
  snapRef.current = snapshot;

  const navigate = useCallback((route: DashboardRoute) => {
    setPage(route.page);
    if (route.noteId) setNoteId(route.noteId);
    if (route.editTaskId) {
      const task = snapRef.current.tasks.find((t) => t.id === route.editTaskId);
      if (task) setEditor({ task });
    } else if (route.newTask) setEditor({ task: null, initial: route.newTask });
    contentRef.current?.scrollTo({ top: 0 });
  }, []);

  useEffect(() => api.app.onNavigate(navigate), [navigate]);

  // Si la tâche en cours d'édition est supprimée ailleurs, on ferme l'éditeur.
  useEffect(() => {
    if (editor?.task && !snapshot.tasks.some((t) => t.id === editor.task!.id)) setEditor(null);
  }, [snapshot.tasks, editor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editor) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setEditor({ task: null });
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editor]);

  const counts = useMemo(() => {
    const today = todayKey(now);
    const open = snapshot.tasks.filter((t) => t.status !== 'done');
    return {
      open: open.length,
      today: open.filter((t) => t.dueDate === today || isOverdue(t, now)).length,
      byProject: open.reduce((m, t) => (t.projectId ? m.set(t.projectId, (m.get(t.projectId) ?? 0) + 1) : m), new Map<string, number>()),
    };
  }, [snapshot.tasks, now]);

  const onEdit = useCallback((task: Task) => setEditor({ task }), []);
  const openProject = (id: string) => {
    setProjectFilter(id);
    setSearch('');
    setPage('tasks');
  };

  return (
    <div className="dash">
      <header className="titlebar drag">
        <div className="brand">
          <Logo />
          Mon Bureau Intelligent
        </div>
        <div className="global-search">
          <Icon name="search" />
          <input
            ref={searchRef}
            className="input"
            placeholder="Rechercher une tâche…  (Ctrl+F)"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              if (page !== 'tasks') setPage('tasks');
            }}
          />
        </div>
        <span className="spacer" />
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditor({ task: null })} title="Nouvelle tâche (Ctrl+N)">
          <Icon name="plus" /> Nouvelle tâche
        </button>
      </header>

      <nav className="sidebar" aria-label="Navigation">
        {NAV.map((n) => (
          <button
            type="button"
            key={n.page}
            className={`nav-item ${page === n.page ? 'on' : ''}`}
            onClick={() => {
              setPage(n.page);
              if (n.page === 'tasks') setProjectFilter('all');
            }}
          >
            <Icon name={n.icon} />
            <span className="label">{n.label}</span>
            {n.page === 'overview' && counts.today > 0 && <span className="badge accent">{counts.today}</span>}
            {n.page === 'tasks' && counts.open > 0 && <span className="badge">{counts.open}</span>}
          </button>
        ))}

        {snapshot.projects.length > 0 && (
          <>
            <div className="nav-heading">Projets</div>
            {snapshot.projects.map((p) => (
              <button type="button" key={p.id} className={`nav-item ${page === 'tasks' && projectFilter === p.id ? 'on' : ''}`} onClick={() => openProject(p.id)}>
                <span className="dot" style={{ background: p.color }} />
                <span className="label">{p.name}</span>
                {(counts.byProject.get(p.id) ?? 0) > 0 && <span className="badge">{counts.byProject.get(p.id)}</span>}
              </button>
            ))}
          </>
        )}

        <span className="grow" />
        <button type="button" className={`nav-item ${page === 'settings' ? 'on' : ''}`} onClick={() => setPage('settings')}>
          <Icon name="settings" />
          <span className="label">Paramètres</span>
        </button>
      </nav>

      <main className="content" ref={contentRef}>
        {page === 'overview' && <Overview snapshot={snapshot} now={now} onEdit={onEdit} navigate={navigate} />}
        {page === 'tasks' && (
          <TasksPage
            snapshot={snapshot}
            now={now}
            search={search}
            setSearch={setSearch}
            projectFilter={projectFilter}
            setProjectFilter={setProjectFilter}
            onEdit={onEdit}
            onNew={() => setEditor({ task: null, initial: projectFilter !== 'all' && projectFilter !== 'none' ? { projectId: projectFilter } : undefined })}
          />
        )}
        {page === 'projects' && <ProjectsPage snapshot={snapshot} openProject={openProject} />}
        {page === 'notes' && <NotesPage snapshot={snapshot} initialId={noteId} />}
        {page === 'widgets' && <WidgetsPage snapshot={snapshot} />}
        {page === 'settings' && <SettingsPage snapshot={snapshot} />}
      </main>

      {editor && (
        <TaskEditor
          key={editor.task?.id ?? 'new'}
          snapshot={snapshot}
          task={editor.task ? (snapshot.tasks.find((t) => t.id === editor.task!.id) ?? editor.task) : null}
          initial={editor.initial}
          onClose={() => setEditor(null)}
        />
      )}
      <Toasts />
    </div>
  );
}
