// Fenêtre de rappels (coin inférieur droit de l'écran).

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AppSnapshot, FiredReminder } from '../../shared/types';
import { api } from '../lib/api';
import { Icon } from '../components/Icon';

/** Petit carillon généré (aucun fichier audio, fonctionne hors ligne). */
function chime(): void {
  try {
    const ctx = new AudioContext();
    const t0 = ctx.currentTime;
    for (const [i, freq] of [880, 1318.5].entries()) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = t0 + i * 0.16;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.9);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 1);
    }
    setTimeout(() => void ctx.close(), 1500);
  } catch {
    /* audio indisponible */
  }
}

const SNOOZE_OPTIONS = [
  { value: 5, label: '5 min' },
  { value: 10, label: '10 min' },
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 heure' },
  { value: 180, label: '3 heures' },
  { value: 1440, label: 'Demain' },
];

function ReminderCard({ item }: { item: FiredReminder }) {
  return (
    <div className="rp-card" data-priority={item.priority}>
      <span className="rp-icon">
        <Icon name="bell" />
      </span>
      <div className="rp-main">
        <div className="rp-label">Rappel{item.priority === 'urgent' ? ' · urgent' : item.priority === 'high' ? ' · priorité élevée' : ''}</div>
        <div className="rp-title">{item.title}</div>
        <div className="rp-when">{item.dueLabel ? `Échéance : ${item.dueLabel}` : 'Rappel ponctuel'}</div>
        <div className="rp-actions">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void api.tasks.setStatus(item.taskId, 'done')}>
            <Icon name="check" /> Terminer
          </button>
          <select
            className="select"
            value=""
            aria-label="Reporter le rappel"
            onChange={(e) => e.target.value && void api.tasks.snooze(item.taskId, Number(e.target.value))}
          >
            <option value="">Reporter…</option>
            {SNOOZE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.value === 1440 ? 'À demain (même heure)' : `Dans ${o.label}`}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              api.app.openDashboard({ page: 'tasks', editTaskId: item.taskId });
              api.reminders.dismiss(item.taskId, item.reminderId);
            }}
          >
            Ouvrir
          </button>
        </div>
      </div>
      <button type="button" className="icon-btn sm rp-close" title="Ignorer" onClick={() => api.reminders.dismiss(item.taskId, item.reminderId)}>
        <Icon name="x" />
      </button>
    </div>
  );
}

export function ReminderPopupView({ snapshot }: { snapshot: AppSnapshot }) {
  const [items, setItems] = useState<FiredReminder[]>([]);
  const stack = useRef<HTMLDivElement>(null);
  const known = useRef(new Set<string>());
  const soundOn = useRef(snapshot.settings.reminderSound);
  soundOn.current = snapshot.settings.reminderSound;

  useEffect(() => {
    const apply = (list: FiredReminder[]) => {
      const fresh = list.some((i) => !known.current.has(`${i.taskId}:${i.reminderId}`));
      known.current = new Set(list.map((i) => `${i.taskId}:${i.reminderId}`));
      if (fresh && soundOn.current) chime();
      setItems(list);
    };
    void api.reminders.getPending().then(apply);
    return api.reminders.onPending(apply);
  }, []);

  useLayoutEffect(() => {
    const el = stack.current;
    if (!el) return;
    const report = () => api.reminders.setPopupHeight(el.getBoundingClientRect().height + 16);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [items.length]);

  const visible = items.slice(0, 4);
  return (
    <div className="rp-root">
      <div className="rp-stack" ref={stack}>
        {items.length > 1 && (
          <div className="rp-head">
            <span className="badge accent">{items.length} rappels</span>
            <button type="button" onClick={() => api.reminders.dismissAll()}>
              Tout ignorer
            </button>
          </div>
        )}
        {visible.map((item) => (
          <ReminderCard key={`${item.taskId}-${item.reminderId}`} item={item} />
        ))}
      </div>
    </div>
  );
}
