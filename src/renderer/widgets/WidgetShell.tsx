// Cadre commun des widgets : en-tête (zone de déplacement), actions, poignées de redimensionnement.

import { useRef, type ReactNode } from 'react';
import type { ResizeEdge } from '../../shared/api';
import { WIDGET_META } from '../../shared/defaults';
import type { AppSnapshot, WidgetType } from '../../shared/types';
import { api } from '../lib/api';
import { Icon } from '../components/Icon';

function ResizeHandle({ edge }: { edge: ResizeEdge }) {
  const active = useRef(false);
  const frame = useRef<number | null>(null);
  return (
    <div
      className={`resize-handle ${edge}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        active.current = true;
        api.widgets.resizeStart(edge);
      }}
      onPointerMove={() => {
        if (!active.current || frame.current !== null) return;
        frame.current = requestAnimationFrame(() => {
          frame.current = null;
          api.widgets.resizeMove();
        });
      }}
      onPointerUp={() => {
        if (!active.current) return;
        active.current = false;
        api.widgets.resizeEnd();
      }}
      onLostPointerCapture={() => {
        if (!active.current) return;
        active.current = false;
        api.widgets.resizeEnd();
      }}
    />
  );
}

export function WidgetShell({
  type,
  snapshot,
  count,
  onAdd,
  addTitle = 'Nouvelle tâche',
  children,
  footer,
  toolbar,
}: {
  type: WidgetType;
  snapshot: AppSnapshot;
  count?: number | string;
  onAdd?: () => void;
  addTitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  toolbar?: ReactNode;
}) {
  const meta = WIDGET_META[type];
  const state = snapshot.widgets.find((w) => w.type === type);
  const locked = snapshot.settings.lockWidgets;
  const pinned = !!state?.alwaysOnTop;
  return (
    <div className="widget-root" data-locked={locked} data-fade={snapshot.settings.fadeInactiveWidgets}>
      <section className="widget-card" aria-label={meta.label}>
        <header className={`widget-header ${locked ? '' : 'drag'}`}>
          <span className="widget-icon">
            <Icon name={meta.icon} />
          </span>
          <span className="widget-title">{meta.label}</span>
          {count !== undefined && <span className="widget-count">{count}</span>}
          <div className="widget-actions no-drag">
            {onAdd && (
              <button type="button" className="icon-btn" title={addTitle} onClick={onAdd}>
                <Icon name="plus" />
              </button>
            )}
            <button
              type="button"
              className={`icon-btn ${pinned ? 'active' : ''}`}
              title={pinned ? 'Ne plus garder au premier plan' : 'Garder au premier plan'}
              aria-pressed={pinned}
              onClick={() => void api.widgets.setAlwaysOnTop(type, !pinned)}
            >
              <Icon name="pin" filled={pinned} />
            </button>
            <button type="button" className="icon-btn" title="Options du widget" onClick={() => api.widgets.menu()}>
              <Icon name="more" />
            </button>
          </div>
        </header>
        {toolbar}
        <div className="widget-body">{children}</div>
        {footer && <div className="widget-footer">{footer}</div>}
        {!locked && (
          <>
            <ResizeHandle edge="e" />
            <ResizeHandle edge="w" />
            <ResizeHandle edge="s" />
            <ResizeHandle edge="se" />
            <ResizeHandle edge="sw" />
          </>
        )}
      </section>
    </div>
  );
}
