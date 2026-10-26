// État partagé de l'interface : instantané reçu du processus principal, mis à jour en temps réel.

import { useEffect, useState, useSyncExternalStore } from 'react';
import type { AppSnapshot } from '../../shared/types';
import { api } from './api';

let current: AppSnapshot | null = null;
const listeners = new Set<() => void>();

function set(next: AppSnapshot): void {
  if (current && next.revision < current.revision) return; // instantané plus ancien reçu en retard
  current = next;
  for (const l of listeners) l();
}

let started = false;
export function startStore(): void {
  if (started) return;
  started = true;
  api.onSnapshot(set);
  api
    .getSnapshot()
    .then(set)
    .catch((err) => api.app.reportError(`getSnapshot: ${String(err)}`));
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useSnapshot(): AppSnapshot | null {
  return useSyncExternalStore(subscribe, () => current);
}

/** Heure courante, rafraîchie régulièrement (vues dépendant de l'heure : retards, « aujourd'hui »). */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    const onVisible = () => setNow(new Date());
    window.addEventListener('focus', onVisible);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', onVisible);
    };
  }, [intervalMs]);
  return now;
}
