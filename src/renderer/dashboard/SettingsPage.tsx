// Paramètres de l'application.

import { useEffect, useState, type ReactNode } from 'react';
import type { BackupInfo } from '../../shared/api';
import { ACCENT_PRESETS } from '../../shared/defaults';
import { formatOffset } from '../../shared/dates';
import type { AppSnapshot, Settings, ShortcutSettings } from '../../shared/types';
import { api } from '../lib/api';
import { Icon } from '../components/Icon';
import { Segmented, Switch, reportResult, toast } from '../components/ui';

function Row({ title, text, children }: { title: string; text?: ReactNode; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div className="text">
        <strong>{title}</strong>
        {text && <span>{text}</span>}
      </div>
      <div className="control">{children}</div>
    </div>
  );
}

function Section({ icon, title, children }: { icon: string; title: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <h2>
        <Icon name={icon} /> {title}
      </h2>
      <div className="card">{children}</div>
    </section>
  );
}

export function displayAccelerator(acc: string): string {
  if (!acc) return 'Aucun';
  return acc
    .split('+')
    .map((p) => (p === 'CommandOrControl' || p === 'CmdOrCtrl' || p === 'Control' ? 'Ctrl' : p === 'Shift' ? 'Maj' : p === 'Super' ? 'Win' : p))
    .join(' + ');
}

function keyFromEvent(e: React.KeyboardEvent): string | null {
  const code = e.code;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code;
  const map: Record<string, string> = {
    Space: 'Space',
    Enter: 'Enter',
    Tab: 'Tab',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Insert: 'Insert',
  };
  return map[code] ?? null;
}

function ShortcutInput({ value, ok, onChange }: { value: string; ok: boolean; onChange: (v: string) => void }) {
  const [recording, setRecording] = useState(false);
  return (
    <>
      <input
        readOnly
        className={`input shortcut-input ${recording ? 'recording' : ''}`}
        value={recording ? 'Appuyez sur la combinaison…' : displayAccelerator(value)}
        onFocus={() => setRecording(true)}
        onBlur={() => setRecording(false)}
        onKeyDown={(e) => {
          e.preventDefault();
          if (e.key === 'Escape') {
            (e.target as HTMLInputElement).blur();
            return;
          }
          if ((e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.altKey) {
            onChange('');
            (e.target as HTMLInputElement).blur();
            return;
          }
          const key = keyFromEvent(e);
          if (!key) return;
          const mods = [e.ctrlKey && 'CommandOrControl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean) as string[];
          if (!mods.length || (mods.length === 1 && mods[0] === 'Shift')) {
            toast('Utilisez au moins Ctrl ou Alt dans le raccourci.', 'error');
            return;
          }
          onChange([...mods, key].join('+'));
          (e.target as HTMLInputElement).blur();
        }}
      />
      {value && !ok && (
        <span className="chip danger" title="Déjà utilisé par une autre application ou réservé par Windows">
          Indisponible
        </span>
      )}
    </>
  );
}

function Backups() {
  const [list, setList] = useState<BackupInfo[] | null>(null);
  const refresh = () => void api.app.listBackups().then(setList);
  useEffect(refresh, []);
  return (
    <>
      <Row title="Sauvegardes automatiques" text="Une copie de vos données est créée chaque jour (les 7 dernières sont conservées).">
        <button
          type="button"
          className="btn"
          onClick={async () => {
            if (reportResult(await api.app.backupNow())) {
              toast('Sauvegarde créée');
              refresh();
            }
          }}
        >
          <Icon name="database" /> Sauvegarder maintenant
        </button>
      </Row>
      {list && list.length > 0 && (
        <div style={{ padding: '4px 18px 14px' }}>
          {list.slice(0, 8).map((b) => (
            <div key={b.file} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', borderTop: '1px solid var(--border)' }}>
              <Icon name="clock" size={14} />
              <span style={{ flex: 1 }}>
                {new Date(b.date).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}
                <span className="field-hint"> · {(b.size / 1024).toFixed(0)} Ko · {b.file.split(/[\\/]/).pop()}</span>
              </span>
              <button
                type="button"
                className="btn btn-sm"
                onClick={async () => {
                  const r = await api.app.restoreBackup(b.file);
                  if (r.ok) toast(`Sauvegarde restaurée (${r.value.tasks} tâches)`);
                  else if (r.errors.form !== 'Restauration annulée.') reportResult(r);
                }}
              >
                Restaurer
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export function SettingsPage({ snapshot }: { snapshot: AppSnapshot }) {
  const s = snapshot.settings;
  const info = snapshot.info;
  const set = async (patch: Partial<Settings>) => reportResult(await api.settings.update(patch));
  const setShortcut = (key: keyof ShortcutSettings, value: string) => void set({ shortcuts: { ...s.shortcuts, [key]: value } });
  const isWindows = info.platform === 'win32';

  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <div className="page-head">
        <div>
          <h1>Paramètres</h1>
          <p>Tout est enregistré automatiquement.</p>
        </div>
      </div>

      <Section icon="palette" title="Apparence">
        <Row title="Thème" text="« Système » suit le mode clair ou sombre de Windows.">
          <Segmented
            value={s.theme}
            onChange={(v) => void set({ theme: v })}
            options={[
              { value: 'system', label: 'Système' },
              { value: 'light', label: <><Icon name="sun" size={13} /> Clair</> },
              { value: 'dark', label: <><Icon name="moon" size={13} /> Sombre</> },
            ]}
          />
        </Row>
        <Row title="Couleur d'accent">
          <div className="color-swatches">
            {ACCENT_PRESETS.map((c) => (
              <button type="button" key={c.value} title={c.name} className={s.accentColor === c.value ? 'on' : ''} style={{ background: c.value }} onClick={() => void set({ accentColor: c.value })} />
            ))}
            <input type="color" value={s.accentColor} title="Couleur personnalisée" onChange={(e) => void set({ accentColor: e.target.value })} />
          </div>
        </Row>
        <Row title="Taille du texte">
          <Segmented
            value={s.fontScale}
            onChange={(v) => void set({ fontScale: v })}
            options={[
              { value: 'compact', label: 'Compacte' },
              { value: 'normal', label: 'Normale' },
              { value: 'large', label: 'Grande' },
            ]}
          />
        </Row>
        <Row title="Animations" text="Transitions et effets légers de l'interface.">
          <Switch checked={s.animations} onChange={(v) => void set({ animations: v })} />
        </Row>
      </Section>

      <Section icon="layers" title="Widgets">
        <Row title="Opacité du fond des widgets">
          <input type="range" className="range" min={40} max={100} value={Math.round(s.widgetOpacity * 100)} onChange={(e) => void set({ widgetOpacity: Number(e.target.value) / 100 })} />
          <span style={{ width: 42, textAlign: 'right' }}>{Math.round(s.widgetOpacity * 100)} %</span>
        </Row>
        {info.nativeDisabledReason && (
          <Row title="Intégration Windows désactivée" text={`Désactivée automatiquement par sécurité : ${info.nativeDisabledReason}. Les widgets fonctionnent normalement, sans les deux options ci-dessous.`}>
            <button type="button" className="btn" onClick={() => api.app.reenableNative()}>
              Réactiver et redémarrer
            </button>
          </Row>
        )}
        <Row
          title="Garder les widgets visibles avec « Afficher le bureau »"
          text={
            info.nativeDesktopSupport
              ? 'Les widgets sont posés sur le bureau, sous vos fenêtres. Quand vous affichez le bureau (Win+D ou clic sur le fond d’écran), ils restent visibles.'
              : 'Disponible uniquement sous Windows.'
          }
        >
          <Switch checked={s.desktopAnchor} disabled={!info.nativeDesktopSupport} onChange={(v) => void set({ desktopAnchor: v })} />
        </Row>
        <Row title="Mode discret" text="Les widgets épinglés au premier plan s'effacent devant les fenêtres maximisées ou en plein écran.">
          <Switch checked={s.discreetMode} disabled={!info.nativeDesktopSupport} onChange={(v) => void set({ discreetMode: v })} />
        </Row>
        <Row title="Estomper les widgets inactifs">
          <Switch checked={s.fadeInactiveWidgets} onChange={(v) => void set({ fadeInactiveWidgets: v })} />
        </Row>
        <Row title="Verrouiller la disposition">
          <Switch checked={s.lockWidgets} onChange={(v) => void set({ lockWidgets: v })} />
        </Row>
        <Row title="Aimanter aux bords et aux autres widgets">
          <Switch checked={s.snapWidgets} onChange={(v) => void set({ snapWidgets: v })} />
        </Row>
        <Row title="Période du widget « À venir »">
          <select className="select" value={s.upcomingDays} onChange={(e) => void set({ upcomingDays: Number(e.target.value) })}>
            {[3, 5, 7, 14, 30].map((d) => (
              <option key={d} value={d}>
                {d} jours
              </option>
            ))}
          </select>
        </Row>
        <Row title="Afficher les tâches terminées du jour">
          <Switch checked={s.showCompletedInWidgets} onChange={(v) => void set({ showCompletedInWidgets: v })} />
        </Row>
      </Section>

      <Section icon="power" title="Démarrage et fenêtre">
        <Row
          title="Lancer au démarrage de Windows"
          text={info.autoStartSupported ? 'Les widgets apparaissent dès l’ouverture de session (tableau de bord masqué).' : 'Disponible dans la version installée ou portable sous Windows.'}
        >
          <Switch checked={s.launchAtStartup} disabled={!info.autoStartSupported} onChange={(v) => void set({ launchAtStartup: v })} />
        </Row>
        <Row title="Ouvrir le tableau de bord au lancement manuel">
          <Switch checked={s.showDashboardOnStart} onChange={(v) => void set({ showDashboardOnStart: v })} />
        </Row>
        <Row title="Fermer le tableau de bord le réduit dans la zone de notification" text="Sinon, la fermeture quitte complètement l'application (widgets et rappels compris).">
          <Switch checked={s.closeToTray} onChange={(v) => void set({ closeToTray: v })} />
        </Row>
        <Row title="Confirmer avant de supprimer une tâche">
          <Switch checked={s.confirmDelete} onChange={(v) => void set({ confirmDelete: v })} />
        </Row>
      </Section>

      <Section icon="bell" title="Rappels et notifications">
        <Row title={isWindows ? 'Notifications Windows' : 'Notifications du système'} text="Affichées dans le centre de notifications.">
          <Switch checked={s.nativeNotifications} onChange={(v) => void set({ nativeNotifications: v })} />
        </Row>
        <Row title="Fenêtre de rappel" text="Petite fenêtre en bas à droite avec « Terminer » et « Reporter » (fonctionne même en mode Ne pas déranger).">
          <Switch checked={s.reminderPopup} onChange={(v) => void set({ reminderPopup: v })} />
        </Row>
        <Row title="Son des rappels">
          <Switch checked={s.reminderSound} onChange={(v) => void set({ reminderSound: v })} />
        </Row>
        <Row title="Résumé quotidien" text="Une notification récapitulant la journée.">
          <input type="time" className="input" value={s.dailyDigestTime} disabled={!s.dailyDigest} onChange={(e) => e.target.value && void set({ dailyDigestTime: e.target.value })} />
          <Switch checked={s.dailyDigest} onChange={(v) => void set({ dailyDigest: v })} />
        </Row>
        <Row title="Rappel par défaut" text="Ajouté automatiquement aux nouvelles tâches qui ont une heure.">
          <select className="select" value={s.defaultReminderOffset ?? 'none'} onChange={(e) => void set({ defaultReminderOffset: e.target.value === 'none' ? null : Number(e.target.value) })}>
            <option value="none">Aucun</option>
            {[0, 5, 10, 15, 30, 60, 120, 1440].map((m) => (
              <option key={m} value={m}>
                {formatOffset(m)}
              </option>
            ))}
          </select>
        </Row>
        <Row title="Heure des rappels pour les tâches sans heure">
          <input type="time" className="input" value={s.defaultReminderTime} onChange={(e) => e.target.value && void set({ defaultReminderTime: e.target.value })} />
        </Row>
        <Row title="Durée de report par défaut">
          <select className="select" value={s.snoozeMinutes} onChange={(e) => void set({ snoozeMinutes: Number(e.target.value) })}>
            {[5, 10, 15, 30, 60].map((m) => (
              <option key={m} value={m}>
                {m} minutes
              </option>
            ))}
          </select>
        </Row>
      </Section>

      <Section icon="keyboard" title="Raccourcis clavier globaux">
        <Row title="Nouvelle tâche (depuis n'importe quelle application)" text="Cliquez puis tapez la combinaison. Retour arrière pour désactiver.">
          <ShortcutInput value={s.shortcuts.quickAdd} ok={info.shortcutStatus.quickAdd} onChange={(v) => setShortcut('quickAdd', v)} />
        </Row>
        <Row title="Afficher / masquer les widgets">
          <ShortcutInput value={s.shortcuts.toggleWidgets} ok={info.shortcutStatus.toggleWidgets} onChange={(v) => setShortcut('toggleWidgets', v)} />
        </Row>
        <Row title="Ouvrir le tableau de bord">
          <ShortcutInput value={s.shortcuts.openDashboard} ok={info.shortcutStatus.openDashboard} onChange={(v) => setShortcut('openDashboard', v)} />
        </Row>
      </Section>

      <Section icon="database" title="Données">
        <Row title="Emplacement des données" text={<code style={{ userSelect: 'text' }}>{info.dataPath}</code>}>
          <button type="button" className="btn" onClick={() => api.app.openDataFolder()}>
            <Icon name="folderOpen" /> Ouvrir
          </button>
        </Row>
        <Row title="Exporter" text="Fichier JSON contenant toutes vos tâches, projets, notes et paramètres.">
          <button
            type="button"
            className="btn"
            onClick={async () => {
              const r = await api.app.exportData();
              if (r.ok && r.value) toast('Export enregistré');
              else reportResult(r);
            }}
          >
            <Icon name="download" /> Exporter
          </button>
        </Row>
        <Row title="Importer" text="Remplacer toutes les données, ou ajouter uniquement les éléments absents (fusion).">
          <button
            type="button"
            className="btn"
            onClick={async () => {
              const r = await api.app.importData('merge');
              if (r.ok && r.value) toast(`${r.value.tasks} tâche(s), ${r.value.projects} projet(s), ${r.value.notes} note(s) ajoutés`);
              else reportResult(r);
            }}
          >
            <Icon name="upload" /> Fusionner…
          </button>
          <button
            type="button"
            className="btn"
            onClick={async () => {
              const r = await api.app.importData('replace');
              if (r.ok && r.value) toast(`Import terminé : ${r.value.tasks} tâche(s)`);
              else reportResult(r);
            }}
          >
            <Icon name="upload" /> Remplacer…
          </button>
        </Row>
        <Backups />
      </Section>

      <Section icon="info" title="À propos">
        <Row
          title={`Mon Bureau Intelligent ${info.version}`}
          text={`${info.isPortable ? 'Version portable' : 'Version installée'} · ${info.platform === 'win32' ? 'Windows' : info.platform}`}
        >
          <span className="chip success">
            <Icon name="shield" /> Hors ligne
          </span>
        </Row>
        <Row title="Confidentialité" text="Aucun compte, aucun abonnement, aucune donnée collectée ni envoyée : tout reste sur cet ordinateur.">
          <span />
        </Row>
        <Row title="Quitter l'application" text="Ferme les widgets et arrête les rappels jusqu'au prochain lancement.">
          <button type="button" className="btn btn-danger" onClick={() => api.app.quit()}>
            Quitter
          </button>
        </Row>
      </Section>
    </div>
  );
}
