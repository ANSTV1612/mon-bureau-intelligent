// Fenêtre de saisie rapide (raccourci global Ctrl+Alt+N par défaut).

import { useEffect, useRef, useState } from 'react';
import { addDays, todayKey } from '../../shared/dates';
import { PRIORITY_LABELS } from '../../shared/defaults';
import type { AppSnapshot, Priority } from '../../shared/types';
import { api } from '../lib/api';
import { useNow } from '../lib/store';
import { Icon } from '../components/Icon';
import { BMark } from '../components/Brand';
import { ParsePreview } from '../components/QuickAddInput';

export function QuickAddView({ snapshot }: { snapshot: AppSnapshot }) {
  const now = useNow();
  const [text, setText] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<Priority | ''>('');
  const [projectId, setProjectId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = () => {
    setText('');
    setDueDate('');
    setPriority('');
    setProjectId('');
    setError(null);
    setCreated(null);
  };

  useEffect(() => {
    const off = api.app.onQuickAddShown(() => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
      reset();
      setTimeout(() => input.current?.focus(), 30);
    });
    input.current?.focus();
    return off;
  }, []);

  const close = () => api.app.closeWindow();

  const submit = async (keepOpen: boolean) => {
    if (!text.trim() || busy) return;
    setBusy(true);
    const result = await api.tasks.quickAdd(text, {
      dueDate: dueDate || null,
      priority: priority || undefined,
      projectId: projectId || null,
    });
    setBusy(false);
    if (!result.ok) {
      setError(Object.values(result.errors)[0] ?? 'Impossible de créer la tâche.');
      return;
    }
    setCreated(result.value.title);
    setText('');
    setError(null);
    if (keepOpen) input.current?.focus();
    else closeTimer.current = setTimeout(close, 550);
  };

  const today = todayKey(now);
  return (
    <div
      className="qa-root"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close();
      }}
    >
      <div className="qa-card">
        <div className="qa-input-row">
          <BMark size={24} />
          <input
            ref={input}
            className="qa-input"
            value={text}
            maxLength={500}
            placeholder="Nouvelle tâche… ex. « Appeler Paul demain 14h #Travail !urgent »"
            aria-label="Nouvelle tâche"
            spellCheck
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
              setCreated(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void submit(e.shiftKey);
              }
            }}
          />
          {busy && <span className="spinner" />}
        </div>
        <ParsePreview text={text} now={now} />
        <div className="qa-options">
          <select className="select" value={dueDate === today ? 'today' : dueDate === addDays(today, 1) ? 'tomorrow' : dueDate ? 'custom' : ''} onChange={(e) => {
            const v = e.target.value;
            setDueDate(v === 'today' ? today : v === 'tomorrow' ? addDays(today, 1) : v === 'custom' ? addDays(today, 2) : '');
          }} aria-label="Échéance">
            <option value="">Échéance : aucune</option>
            <option value="today">Aujourd'hui</option>
            <option value="tomorrow">Demain</option>
            <option value="custom">Autre date…</option>
          </select>
          {dueDate && dueDate !== today && dueDate !== addDays(today, 1) && (
            <input type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} aria-label="Date" />
          )}
          <select className="select" value={priority} onChange={(e) => setPriority(e.target.value as Priority | '')} aria-label="Priorité">
            <option value="">Priorité : normale</option>
            {(['urgent', 'high', 'low'] as Priority[]).map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
          <select className="select" value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Projet">
            <option value="">Sans projet</option>
            {snapshot.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        {error && <span className="field-error">{error}</span>}
        <div className="qa-footer">
          {created ? (
            <span className="qa-success">
              <Icon name="check" /> « {created} » ajoutée
            </span>
          ) : (
            <span>
              <span className="kbd">Entrée</span> ajouter · <span className="kbd">Maj</span>+<span className="kbd">Entrée</span> ajouter et continuer ·{' '}
              <span className="kbd">Échap</span> fermer
            </span>
          )}
          <span className="spacer" />
          <button type="button" className="btn btn-primary btn-sm" disabled={!text.trim() || busy} onClick={() => void submit(false)}>
            Ajouter
          </button>
        </div>
      </div>
    </div>
  );
}
