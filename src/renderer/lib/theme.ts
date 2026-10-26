// Application du thème (clair/sombre/système), de la couleur d'accent et des préférences d'affichage.

import { useEffect, useState } from 'react';
import type { Settings } from '../../shared/types';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function shade(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex).map((c) => Math.max(0, Math.min(255, Math.round(c + amount * (amount < 0 ? c : 255 - c)))));
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

export function useResolvedDark(theme: Settings['theme'] | undefined): boolean {
  const [systemDark, setSystemDark] = useState(darkQuery.matches);
  useEffect(() => {
    const onChange = () => setSystemDark(darkQuery.matches);
    darkQuery.addEventListener('change', onChange);
    return () => darkQuery.removeEventListener('change', onChange);
  }, []);
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return systemDark;
}

export function useApplyTheme(settings: Settings | undefined, platform: string | undefined): void {
  const dark = useResolvedDark(settings?.theme);
  useEffect(() => {
    if (!settings) return;
    const root = document.documentElement;
    root.dataset.theme = dark ? 'dark' : 'light';
    root.dataset.font = settings.fontScale;
    root.dataset.animations = settings.animations ? 'on' : 'off';
    if (platform) root.dataset.platform = platform;
    const accent = settings.accentColor;
    const [r, g, b] = hexToRgb(accent);
    root.style.setProperty('--accent', dark ? shade(accent, 0.12) : accent);
    root.style.setProperty('--accent-rgb', `${r}, ${g}, ${b}`);
    root.style.setProperty('--accent-strong', shade(accent, dark ? 0.2 : -0.14));
    root.style.setProperty('--accent-contrast', luminance(accent) > 0.45 ? '#111111' : '#ffffff');
    root.style.setProperty('--widget-alpha', String(settings.widgetOpacity));
  }, [settings, dark, platform]);
}
