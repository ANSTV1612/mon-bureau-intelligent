// Point d'entrée de l'interface. Une seule page sert toutes les fenêtres ; la vue est choisie
// d'après l'adresse : #/dashboard, #/widget/<type>, #/quick-add, #/reminders.

import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { WIDGET_TYPES, type WidgetType } from '../shared/types';
import { api } from './lib/api';
import { startStore, useSnapshot } from './lib/store';
import { useApplyTheme } from './lib/theme';
import { Dashboard } from './dashboard/Dashboard';
import { WidgetView } from './widgets/Widgets';
import { QuickAddView } from './quickadd/QuickAdd';
import { ReminderPopupView } from './reminder/ReminderPopup';
import './styles/base.css';
import './styles/components.css';
import './styles/widgets.css';
import './styles/dashboard.css';
import './styles/overlays.css';

type View = { kind: 'dashboard' } | { kind: 'widget'; type: WidgetType } | { kind: 'quick-add' } | { kind: 'reminders' };

function parseView(): View {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const [first, second] = hash.split('/');
  if (first === 'widget' && (WIDGET_TYPES as readonly string[]).includes(second)) return { kind: 'widget', type: second as WidgetType };
  if (first === 'quick-add') return { kind: 'quick-add' };
  if (first === 'reminders') return { kind: 'reminders' };
  return { kind: 'dashboard' };
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidCatch(error: Error) {
    api.app.reportError(`${error.message}\n${error.stack ?? ''}`);
  }
  override render() {
    if (this.state.error) {
      return (
        <div className="error-screen">
          <div>
            <p>
              <strong>Un problème d'affichage est survenu.</strong>
            </p>
            <p style={{ color: 'var(--text-2)' }}>Vos données ne sont pas affectées.</p>
            <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
              Recharger
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const view = parseView();
document.body.classList.add(`view-${view.kind}`);

window.addEventListener('error', (e) => api.app.reportError(`${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => api.app.reportError(`Promesse rejetée : ${String(e.reason)}`));

function App() {
  const snapshot = useSnapshot();
  useApplyTheme(snapshot?.settings, snapshot?.info.platform);
  if (!snapshot) return null;
  switch (view.kind) {
    case 'widget':
      return <WidgetView type={view.type} snapshot={snapshot} />;
    case 'quick-add':
      return <QuickAddView snapshot={snapshot} />;
    case 'reminders':
      return <ReminderPopupView snapshot={snapshot} />;
    default:
      return <Dashboard snapshot={snapshot} />;
  }
}

startStore();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
