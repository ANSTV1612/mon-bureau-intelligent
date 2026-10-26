// Icône et menu de la zone de notification Windows.

import { Menu, nativeImage, Tray, type MenuItemConstructorOptions } from 'electron';
import path from 'node:path';
import { WIDGET_META, WIDGET_ORDER } from '../shared/defaults';
import type { Settings, WidgetState, WidgetType } from '../shared/types';
import { getAppPaths } from './windows/common';

export interface TrayActions {
  openDashboard: (page?: 'overview' | 'settings' | 'widgets') => void;
  quickAdd: () => void;
  toggleWidget: (type: WidgetType, visible: boolean) => void;
  showAll: () => void;
  hideAll: () => void;
  resetLayout: () => void;
  updateSettings: (patch: Partial<Settings>) => void;
  quit: () => void;
}

export interface TrayState {
  widgets: WidgetState[];
  allHidden: boolean;
  settings: Settings;
  todayCount: number;
  overdueCount: number;
  autoStartSupported: boolean;
}

export class AppTray {
  private tray: Tray | null = null;

  constructor(private readonly actions: TrayActions) {}

  create(): void {
    const res = getAppPaths().resources;
    const file = process.platform === 'win32' ? 'tray.ico' : 'tray.png';
    const image = nativeImage.createFromPath(path.join(res, file));
    this.tray = new Tray(image.isEmpty() ? nativeImage.createFromPath(path.join(res, 'icon.png')).resize({ width: 16 }) : image);
    this.tray.on('click', () => this.actions.openDashboard());
    this.tray.on('double-click', () => this.actions.openDashboard());
  }

  update(state: TrayState): void {
    if (!this.tray) return;
    const shortcut = (acc: string) => acc.replace('CommandOrControl', 'Ctrl').replace(/\+/g, '+');
    const parts = [`${state.todayCount} tâche${state.todayCount > 1 ? 's' : ''} aujourd'hui`];
    if (state.overdueCount) parts.push(`${state.overdueCount} en retard`);
    this.tray.setToolTip(`Mon Bureau Intelligent — ${parts.join(', ')}`);

    const widgetItems: MenuItemConstructorOptions[] = WIDGET_ORDER.map((type) => {
      const w = state.widgets.find((s) => s.type === type);
      return {
        label: WIDGET_META[type].label,
        type: 'checkbox',
        checked: !!w?.visible,
        click: (item) => this.actions.toggleWidget(type, item.checked),
      };
    });

    const template: MenuItemConstructorOptions[] = [
      { label: 'Ouvrir le tableau de bord', click: () => this.actions.openDashboard('overview') },
      {
        label: 'Nouvelle tâche…',
        accelerator: state.settings.shortcuts.quickAdd ? shortcut(state.settings.shortcuts.quickAdd) : undefined,
        registerAccelerator: false,
        click: () => this.actions.quickAdd(),
      },
      { type: 'separator' },
      {
        label: state.allHidden ? 'Afficher les widgets' : 'Afficher les widgets au premier plan',
        click: () => this.actions.showAll(),
      },
      { label: 'Masquer les widgets', enabled: !state.allHidden, click: () => this.actions.hideAll() },
      {
        label: 'Widgets',
        submenu: [
          ...widgetItems,
          { type: 'separator' },
          { label: 'Gérer les widgets…', click: () => this.actions.openDashboard('widgets') },
          { label: 'Réinitialiser la disposition', click: () => this.actions.resetLayout() },
        ],
      },
      {
        label: 'Verrouiller la disposition',
        type: 'checkbox',
        checked: state.settings.lockWidgets,
        click: (item) => this.actions.updateSettings({ lockWidgets: item.checked }),
      },
      {
        label: 'Mode discret',
        type: 'checkbox',
        checked: state.settings.discreetMode,
        click: (item) => this.actions.updateSettings({ discreetMode: item.checked }),
      },
      { type: 'separator' },
      {
        label: 'Lancer au démarrage de Windows',
        type: 'checkbox',
        visible: state.autoStartSupported,
        checked: state.settings.launchAtStartup,
        click: (item) => this.actions.updateSettings({ launchAtStartup: item.checked }),
      },
      { label: 'Paramètres…', click: () => this.actions.openDashboard('settings') },
      { type: 'separator' },
      { label: 'Quitter Mon Bureau Intelligent', click: () => this.actions.quit() },
    ];
    this.tray.setContextMenu(Menu.buildFromTemplate(template));
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }
}
