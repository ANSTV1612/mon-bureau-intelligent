// Champ de saisie rapide : « Appeler Paul demain 14h #Travail !urgent » + aperçu de l'analyse.

import { useMemo, useRef, useState, type RefObject } from 'react';
import type { QuickAddDefaults } from '../../shared/api';
import { formatDayLabel } from '../../shared/dates';
import { PRIORITY_LABELS } from '../../shared/defaults';
import { parseQuickAdd } from '../../shared/quickParse';
import { api } from '../lib/api';
import { Icon } from './Icon';

export function ParsePreview({ text, now }: { text: string; now: Date }) {
  const parsed = useMemo(() => (text.trim() ? parseQuickAdd(text, now) : null), [text, now]);
  if (!parsed || !parsed.matches.length) return null;
  return (
    <div className="parse-preview" aria-live="polite">
      {parsed.dueDate && (
        <span className="chip accent">
          <Icon name="calendar" />
          {formatDayLabel(parsed.dueDate, now)}
        </span>
      )}
      {parsed.dueTime && (
        <span className="chip accent">
          <Icon name="clock" />
          {parsed.dueTime}
        </span>
      )}
      {parsed.priority && (
        <span className={`chip ${parsed.priority === 'urgent' ? 'danger' : parsed.priority === 'high' ? 'warning' : ''}`}>
          <Icon name="flag" />
          {PRIORITY_LABELS[parsed.priority]}
        </span>
      )}
      {parsed.projectName && (
        <span className="chip">
          <Icon name="folder" />
          {parsed.projectName}
        </span>
      )}
    </div>
  );
}

export function QuickAddInput({
  defaults,
  placeholder = 'Ajouter une tâche…',
  now,
  autoFocus,
  onCreated,
  inputRef,
}: {
  defaults?: QuickAddDefaults;
  placeholder?: string;
  now: Date;
  autoFocus?: boolean;
  onCreated?: () => void;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ownRef = useRef<HTMLInputElement>(null);
  const input = inputRef ?? ownRef;

  const submit = async () => {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      const result = await api.tasks.quickAdd(value, defaults);
      if (result.ok) {
        setText('');
        setError(null);
        onCreated?.();
      } else setError(Object.values(result.errors)[0] ?? 'Impossible de créer la tâche.');
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  };

  return (
    <div className="inline-add">
      <div className="inline-add-row">
        <Icon name="plus" />
        <input
          ref={input}
          value={text}
          autoFocus={autoFocus}
          placeholder={placeholder}
          maxLength={500}
          aria-label="Nouvelle tâche"
          spellCheck
          onChange={(e) => {
            setText(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void submit();
            } else if (e.key === 'Escape') {
              setText('');
              setError(null);
              input.current?.blur();
            }
          }}
        />
        {busy && <span className="spinner" />}
      </div>
      <ParsePreview text={text} now={now} />
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}
