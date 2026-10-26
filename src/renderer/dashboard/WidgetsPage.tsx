// Gestion des widgets du bureau : affichage, premier plan, disposition.

import { WIDGET_META, WIDGET_ORDER } from '../../shared/defaults';
import type { AppSnapshot, Settings } from '../../shared/types';
import { api } from '../lib/api';
import { Icon } from '../components/Icon';
import { Switch, reportResult } from '../components/ui';

export function WidgetsPage({ snapshot }: { snapshot: AppSnapshot }) {
  const s = snapshot.settings;
  const set = async (patch: Partial<Settings>) => reportResult(await api.settings.update(patch));
  const visibleCount = snapshot.widgets.filter((w) => w.visible).length;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Widgets du bureau</h1>
          <p>
            {visibleCount} widget{visibleCount > 1 ? 's' : ''} affiché{visibleCount > 1 ? 's' : ''}. Déplacez-les par leur titre, redimensionnez-les par les bords.
          </p>
        </div>
        <span className="spacer" />
        <button type="button" className="btn" onClick={() => void api.widgets.hideAll()}>
          <Icon name="eyeOff" /> Masquer tout
        </button>
        <button type="button" className="btn" onClick={() => void api.widgets.showAll()}>
          <Icon name="eye" /> Afficher au premier plan
        </button>
        <button
          type="button"
          className="btn"
          onClick={async () => {
            if (await api.app.confirm('Réinitialiser la disposition des widgets ?', 'Les widgets reprendront leur position, leur taille et leur visibilité par défaut.')) {
              await api.widgets.resetLayout();
            }
          }}
        >
          <Icon name="repeat" /> Réinitialiser
        </button>
      </div>

      <div className="widget-grid">
        {WIDGET_ORDER.map((type) => {
          const meta = WIDGET_META[type];
          const state = snapshot.widgets.find((w) => w.type === type);
          return (
            <div className="card widget-card-admin" key={type}>
              <div className="top">
                <span className="ico">
                  <Icon name={meta.icon} />
                </span>
                <h3>{meta.label}</h3>
                <Switch label={`Afficher ${meta.label}`} checked={!!state?.visible} onChange={(v) => void api.widgets.setVisible(type, v)} />
              </div>
              <p>{meta.description}</p>
              <div className="row">
                <span>Toujours au premier plan</span>
                <Switch label={`${meta.label} au premier plan`} checked={!!state?.alwaysOnTop} onChange={(v) => void api.widgets.setAlwaysOnTop(type, v)} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="settings-section" style={{ marginTop: 22 }}>
        <h2>
          <Icon name="layers" /> Comportement des widgets
        </h2>
        <div className="card">
          <div className="setting-row">
            <div className="text">
              <strong>Opacité du fond</strong>
              <span>Une opacité plus faible laisse apparaître le fond d'écran.</span>
            </div>
            <div className="control">
              <input
                type="range"
                className="range"
                min={40}
                max={100}
                step={1}
                value={Math.round(s.widgetOpacity * 100)}
                onChange={(e) => void set({ widgetOpacity: Number(e.target.value) / 100 })}
              />
              <span style={{ width: 42, textAlign: 'right' }}>{Math.round(s.widgetOpacity * 100)} %</span>
            </div>
          </div>
          <div className="setting-row">
            <div className="text">
              <strong>Mode discret</strong>
              <span>Les widgets « au premier plan » passent derrière une fenêtre maximisée ou en plein écran.{!snapshot.info.nativeDesktopSupport && ' (Disponible sous Windows.)'}</span>
            </div>
            <div className="control">
              <Switch checked={s.discreetMode} onChange={(v) => void set({ discreetMode: v })} />
            </div>
          </div>
          <div className="setting-row">
            <div className="text">
              <strong>Verrouiller la disposition</strong>
              <span>Empêche de déplacer ou redimensionner les widgets par erreur.</span>
            </div>
            <div className="control">
              <Switch checked={s.lockWidgets} onChange={(v) => void set({ lockWidgets: v })} />
            </div>
          </div>
          <div className="setting-row">
            <div className="text">
              <strong>Estomper les widgets inactifs</strong>
              <span>Les widgets deviennent transparents tant que la souris n'est pas dessus.</span>
            </div>
            <div className="control">
              <Switch checked={s.fadeInactiveWidgets} onChange={(v) => void set({ fadeInactiveWidgets: v })} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
