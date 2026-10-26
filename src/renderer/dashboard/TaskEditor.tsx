// Éditeur de tâche (création / modification) avec validation et rappels configurables.

import { useEffect, useRef, useState } from 'react';
import type { DashboardRoute } from '../../shared/api';
import { addDays, formatOffset, toLocalDateTimeKey, todayKey } from '../../shared/dates';
import { LIMITS, PRIORITY_LABELS, REMINDER_PRESETS, STATUS_LABELS } from '../../shared/defaults';
import { describeReminder } from '../../shared/reminders';
import type { AppSnapshot, Priority, ReminderInput, Task, TaskStatus } from '../../shared/types';
import { api } from '../lib/api';
import { Icon } from '../components/Icon';
import { Field, Modal, Segmented, toast } from '../components/ui';

interface Props {
  snapshot: AppSnapshot;
  task: Task | null;
  initial?: DashboardRoute['newTask'];
  onClose: () => void;
}

const PRIORITY_COLORS: Record<Priority, string> = {
  low: 'var(--p-low)',
  normal: 'var(--p-normal)',
  high: 'var(--p-high)',
  urgent: 'var(--p-urgent)',
};

export function TaskEditor({ snapshot, task, initial, onClose }: Props) {
  const settings = snapshot.settings;
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [dueDate, setDueDate] = useState(task?.dueDate ?? initial?.dueDate ?? '');
  const [dueTime, setDueTime] = useState(task?.dueTime ?? '');
  const [priority, setPriority] = useState<Priority>(task?.priority ?? initial?.priority ?? 'normal');
  const [projectId, setProjectId] = useState(task?.projectId ?? initial?.projectId ?? '');
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? 'todo');
  const [reminders, setReminders] = useState<ReminderInput[]>(task?.reminders.filter((r) => !r.snooze || !r.firedAt) ?? []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [newProject, setNewProject] = useState<string | null>(null);
  const [customAt, setCustomAt] = useState<string | null>(null);
  const autoReminder = useRef(!!task);
  const titleRef = useRef<HTMLInputElement>(null);
  const today = todayKey();

  useEffect(() => titleRef.current?.focus(), []);

  // Nouvelle tâche : ajoute le rappel par défaut dès qu'une heure est choisie.
  useEffect(() => {
    if (autoReminder.current || !dueTime || !dueDate || settings.defaultReminderOffset === null) return;
    autoReminder.current = true;
    if (!reminders.length) setReminders([{ type: 'relative', offsetMinutes: settings.defaultReminderOffset }]);
  }, [dueTime, dueDate, reminders.length, settings.defaultReminderOffset]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    const payload = {
      title,
      description,
      dueDate: dueDate || null,
      dueTime: dueDate && dueTime ? dueTime : null,
      priority,
      projectId: projectId || null,
      status,
      reminders: dueDate ? reminders : reminders.filter((r) => r.type === 'absolute'),
    };
    const result = task ? await api.tasks.update(task.id, payload) : await api.tasks.create(payload);
    setSaving(false);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    toast(task ? 'Tâche enregistrée' : 'Tâche créée');
    onClose();
  };

  const remove = async () => {
    if (!task) return;
    if (settings.confirmDelete && !(await api.app.confirm(`Supprimer la tâche « ${task.title} » ?`, 'Cette action est définitive.'))) return;
    const r = await api.tasks.remove(task.id);
    if (r.ok) {
      toast('Tâche supprimée');
      onClose();
    }
  };

  const createProject = async () => {
    if (!newProject?.trim()) return;
    const r = await api.projects.create({ name: newProject });
    if (r.ok) {
      setProjectId(r.value.id);
      setNewProject(null);
    } else setErrors({ ...errors, projectId: Object.values(r.errors)[0] });
  };

  const addReminder = (value: string) => {
    if (value === 'custom') {
      const base = dueDate ? `${dueDate}T${dueTime || settings.defaultReminderTime}` : toLocalDateTimeKey(new Date(Date.now() + 3_600_000));
      setCustomAt(base);
      return;
    }
    const offset = Number(value);
    if (!reminders.some((r) => r.type === 'relative' && r.offsetMinutes === offset)) {
      setReminders([...reminders, { type: 'relative', offsetMinutes: offset }]);
    }
  };

  return (
    <Modal
      title={task ? 'Modifier la tâche' : 'Nouvelle tâche'}
      onClose={onClose}
      width={660}
      footer={
        <>
          {task && (
            <button type="button" className="btn btn-danger" onClick={() => void remove()}>
              <Icon name="trash" /> Supprimer
            </button>
          )}
          {task && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={async () => {
                const r = await api.tasks.duplicate(task.id);
                if (r.ok) {
                  toast('Tâche dupliquée');
                  onClose();
                }
              }}
            >
              <Icon name="copy" /> Dupliquer
            </button>
          )}
          <span className="spacer" />
          <span className="field-hint">
            <span className="kbd">Ctrl</span>+<span className="kbd">Entrée</span>
          </span>
          <button type="button" className="btn" onClick={onClose}>
            Annuler
          </button>
          <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save()}>
            {task ? 'Enregistrer' : 'Créer la tâche'}
          </button>
        </>
      }
    >
      <div
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void save();
          }
        }}
        style={{ display: 'contents' }}
      >
        <Field error={errors.title}>
          <input
            ref={titleRef}
            className="editor-title"
            placeholder="Que devez-vous faire ?"
            value={title}
            maxLength={LIMITS.titleMax}
            onChange={(e) => {
              setTitle(e.target.value);
              if (errors.title) setErrors({ ...errors, title: '' });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.ctrlKey) {
                e.preventDefault();
                void save();
              }
            }}
            aria-label="Titre"
          />
        </Field>
        <Field label="Description (facultative)" error={errors.description}>
          <textarea
            className={`textarea ${errors.description ? 'invalid' : ''}`}
            value={description}
            maxLength={LIMITS.descriptionMax}
            placeholder="Détails, liens, étapes…"
            rows={3}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>

        <div className="editor-grid">
          <Field label="Échéance" error={errors.dueDate}>
            <div style={{ display: 'flex', gap: 6 }}>
              <input type="date" className={`input ${errors.dueDate ? 'invalid' : ''}`} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              {dueDate && (
                <button type="button" className="icon-btn" title="Retirer l'échéance" onClick={() => { setDueDate(''); setDueTime(''); }} style={{ height: 34, width: 34 }}>
                  <Icon name="x" />
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
              {[
                { label: "Aujourd'hui", value: today },
                { label: 'Demain', value: addDays(today, 1) },
                { label: '+1 semaine', value: addDays(today, 7) },
              ].map((q) => (
                <button type="button" key={q.label} className={`chip ${dueDate === q.value ? 'accent' : ''}`} style={{ border: 'none', cursor: 'pointer' }} onClick={() => setDueDate(q.value)}>
                  {q.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Heure (facultative)" error={errors.dueTime}>
            <input
              type="time"
              className={`input ${errors.dueTime ? 'invalid' : ''}`}
              value={dueTime}
              disabled={!dueDate}
              title={dueDate ? undefined : "Choisissez d'abord une date"}
              onChange={(e) => setDueTime(e.target.value)}
            />
          </Field>

          <Field label="Priorité" className="full" error={errors.priority}>
            <Segmented
              value={priority}
              onChange={setPriority}
              ariaLabel="Priorité"
              options={(['low', 'normal', 'high', 'urgent'] as Priority[]).map((p) => ({ value: p, label: PRIORITY_LABELS[p], dot: PRIORITY_COLORS[p] }))}
            />
          </Field>

          <Field label="Statut" error={errors.status}>
            <Segmented
              value={status}
              onChange={setStatus}
              ariaLabel="Statut"
              options={(['todo', 'in_progress', 'done'] as TaskStatus[]).map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
            />
          </Field>

          <Field label="Projet / catégorie" error={errors.projectId}>
            {newProject === null ? (
              <select
                className="select"
                value={projectId}
                onChange={(e) => {
                  if (e.target.value === '__new') setNewProject('');
                  else setProjectId(e.target.value);
                }}
              >
                <option value="">Sans projet</option>
                {snapshot.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
                <option value="__new">+ Nouveau projet…</option>
              </select>
            ) : (
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  className="input"
                  autoFocus
                  placeholder="Nom du projet"
                  maxLength={LIMITS.projectNameMax}
                  value={newProject}
                  onChange={(e) => setNewProject(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void createProject();
                    }
                    if (e.key === 'Escape') {
                      e.stopPropagation();
                      setNewProject(null);
                    }
                  }}
                />
                <button type="button" className="btn" onClick={() => void createProject()}>
                  Créer
                </button>
              </div>
            )}
          </Field>

          <Field label="Rappels" className="full" error={errors.reminders} hint={!dueDate ? 'Ajoutez une échéance pour programmer un rappel avant celle-ci, ou choisissez une date précise.' : undefined}>
            <div className="reminder-list">
              {reminders.map((r, i) => (
                <span className={`chip removable ${r.firedAt ? '' : 'accent'}`} key={`${r.type}-${r.offsetMinutes}-${r.at}-${i}`} title={r.firedAt ? 'Déjà déclenché' : undefined}>
                  <Icon name="bell" />
                  {describeReminder(r)}
                  {r.firedAt ? ' (passé)' : ''}
                  <button type="button" aria-label="Retirer ce rappel" onClick={() => setReminders(reminders.filter((_, j) => j !== i))}>
                    <Icon name="x" size={10} />
                  </button>
                </span>
              ))}
              {customAt !== null ? (
                <>
                  <input type="datetime-local" className="input" value={customAt} onChange={(e) => setCustomAt(e.target.value)} />
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      if (customAt) setReminders([...reminders, { type: 'absolute', at: customAt.slice(0, 16) }]);
                      setCustomAt(null);
                    }}
                  >
                    Ajouter
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCustomAt(null)}>
                    Annuler
                  </button>
                </>
              ) : (
                <select
                  className="select"
                  value=""
                  onChange={(e) => addReminder(e.target.value)}
                  disabled={reminders.length >= LIMITS.remindersMax}
                  aria-label="Ajouter un rappel"
                >
                  <option value="">+ Ajouter un rappel</option>
                  {REMINDER_PRESETS.map((m) => (
                    <option key={m} value={m} disabled={!dueDate}>
                      {formatOffset(m)}
                      {!dueTime && dueDate && m < 1440 ? ` (réf. ${settings.defaultReminderTime})` : ''}
                    </option>
                  ))}
                  <option value="custom">Date et heure précises…</option>
                </select>
              )}
            </div>
          </Field>
        </div>
        {errors.form && <div className="field-error">{errors.form}</div>}
      </div>
    </Modal>
  );
}
