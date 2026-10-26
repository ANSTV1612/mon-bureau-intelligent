// Ligne de tâche : case à cocher animée, titre, échéance, projet, priorité, rappels.

import { memo, useEffect, useRef, useState } from 'react';
import { PRIORITY_LABELS, STATUS_LABELS } from '../../shared/defaults';
import { diffDays, formatDayLabel, todayKey } from '../../shared/dates';
import { isOverdue } from '../../shared/queries';
import type { Project, Task } from '../../shared/types';
import { api } from '../lib/api';
import { Icon } from './Icon';

interface Props {
  task: Task;
  project?: Project | null;
  now: Date;
  /** Affichage compact (widgets) ou détaillé (tableau de bord). */
  variant?: 'widget' | 'list';
  showProject?: boolean;
  showDate?: boolean;
  showDescription?: boolean;
  onEdit?: (task: Task) => void;
}

export function CheckButton({ task, onToggle }: { task: Task; onToggle: () => void }) {
  const done = task.status === 'done';
  return (
    <button
      type="button"
      className={`check ${done ? 'checked' : ''} ${task.status === 'in_progress' ? 'in-progress' : ''}`}
      data-priority={task.priority}
      role="checkbox"
      aria-checked={done}
      aria-label={done ? 'Marquer comme à faire' : 'Marquer comme terminée'}
      title={done ? 'Marquer comme à faire' : `Terminer (${STATUS_LABELS[task.status].toLowerCase()})`}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </button>
  );
}

function TaskItemInner({ task, project, now, variant = 'widget', showProject = true, showDate = true, showDescription, onEdit }: Props) {
  const [completing, setCompleting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  useEffect(() => setCompleting(false), [task.status]);

  const done = task.status === 'done';
  const overdue = isOverdue(task, now);
  const today = todayKey(now);

  const toggle = () => {
    if (done) {
      void api.tasks.toggle(task.id);
      return;
    }
    // Petite animation avant la mise à jour (la tâche va changer de section).
    setCompleting(true);
    timer.current = setTimeout(() => void api.tasks.toggle(task.id), 380);
  };

  const edit = () => {
    if (onEdit) onEdit(task);
    else api.app.openDashboard({ page: 'tasks', editTaskId: task.id });
  };

  let dueClass = '';
  let dueLabel = '';
  if (task.dueDate && showDate) {
    dueLabel = formatDayLabel(task.dueDate, now);
    if (overdue) {
      const days = diffDays(task.dueDate, today);
      dueClass = 'overdue';
      if (days > 0) dueLabel = days === 1 ? 'Hier' : `En retard de ${days} j`;
    } else if (task.dueDate === today && !done) dueClass = 'today';
  }
  const hasReminder = task.reminders.some((r) => !r.firedAt);
  const showFlag = task.priority === 'urgent' || task.priority === 'high';

  return (
    <li
      className={`task-item ${done ? 'done' : ''} ${completing ? 'completing' : ''} ${variant === 'list' ? 'wrap' : ''}`}
      onDoubleClick={edit}
      onContextMenu={(e) => {
        e.preventDefault();
        api.tasks.contextMenu(task.id);
      }}
      data-task-id={task.id}
    >
      <CheckButton task={completing ? { ...task, status: 'done' } : task} onToggle={toggle} />
      <div className="task-main" onClick={variant === 'list' ? edit : undefined} style={variant === 'list' ? { cursor: 'pointer' } : undefined}>
        <span className="task-title" title={task.title}>
          {task.title}
        </span>
        {showDescription && task.description && <div className="task-desc">{task.description}</div>}
        {(dueLabel || task.dueTime || (showProject && project) || hasReminder || task.status === 'in_progress') && (
          <div className="task-meta">
            {task.status === 'in_progress' && !done && (
              <span className="status-progress">
                <Icon name="play" filled />
                En cours
              </span>
            )}
            {(dueLabel || task.dueTime) && (
              <span className={dueClass}>
                <Icon name={task.dueTime ? 'clock' : 'calendar'} />
                {[dueLabel, task.dueTime].filter(Boolean).join(' · ')}
              </span>
            )}
            {showProject && project && (
              <span>
                <i className="project-dot" style={{ background: project.color }} />
                {project.name}
              </span>
            )}
            {hasReminder && !done && (
              <span title="Rappel programmé">
                <Icon name="bell" />
              </span>
            )}
          </div>
        )}
      </div>
      <div className="task-side">
        {showFlag && !done && (
          <span className="prio-flag" data-priority={task.priority} title={`Priorité ${PRIORITY_LABELS[task.priority].toLowerCase()}`}>
            <Icon name="flag" filled={task.priority === 'urgent'} />
          </span>
        )}
        {variant === 'list' && (
          <button type="button" className="icon-btn sm" title="Modifier" onClick={edit}>
            <Icon name="edit" />
          </button>
        )}
        <button
          type="button"
          className="icon-btn sm"
          title="Actions"
          onClick={(e) => {
            e.stopPropagation();
            api.tasks.contextMenu(task.id);
          }}
        >
          <Icon name="more" />
        </button>
      </div>
    </li>
  );
}

export const TaskItem = memo(TaskItemInner);
