import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/shared/defaults';
import {
  isValidAccelerator,
  sanitizeStoredSettings,
  validateNoteInput,
  validateProjectInput,
  validateSettingsPatch,
  validateTaskInput,
} from '../../src/shared/validation';

describe('validateTaskInput', () => {
  it('accepte une tâche minimale et applique les valeurs par défaut', () => {
    const r = validateTaskInput({ title: '  Acheter du pain  ' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({
      title: 'Acheter du pain',
      description: '',
      dueDate: null,
      dueTime: null,
      priority: 'normal',
      status: 'todo',
      projectId: null,
      reminders: [],
    });
  });

  it('refuse un titre vide ou trop long', () => {
    const empty = validateTaskInput({ title: '   ' });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.errors.title).toMatch(/obligatoire/);
    const long = validateTaskInput({ title: 'x'.repeat(201) });
    expect(long.ok).toBe(false);
  });

  it('refuse les dates, heures, priorités et statuts invalides', () => {
    const r = validateTaskInput({ title: 'a', dueDate: '2026-02-30', dueTime: '25:00', priority: 'max', status: 'fini' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errors).sort()).toEqual(['dueDate', 'dueTime', 'priority', 'status']);
  });

  it("exige une date quand une heure est fournie", () => {
    const r = validateTaskInput({ title: 'a', dueTime: '10:00' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.dueTime).toMatch(/nécessite une date/);
  });

  it('valide les rappels et supprime les doublons', () => {
    const r = validateTaskInput({
      title: 'a',
      dueDate: '2026-10-27',
      reminders: [
        { type: 'relative', offsetMinutes: 15 },
        { type: 'relative', offsetMinutes: 15 },
        { type: 'absolute', at: '2026-10-27T08:00' },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.reminders).toHaveLength(2);
  });

  it("refuse un rappel relatif sans date d'échéance", () => {
    const r = validateTaskInput({ title: 'a', reminders: [{ type: 'relative', offsetMinutes: 0 }] });
    expect(r.ok).toBe(false);
  });

  it('refuse des données non objet (IPC malveillant)', () => {
    expect(validateTaskInput(null).ok).toBe(false);
    expect(validateTaskInput('titre').ok).toBe(false);
    expect(validateTaskInput({ title: 'a', reminders: 'x' }).ok).toBe(false);
  });

  it('nettoie les caractères de contrôle', () => {
    const r = validateTaskInput({ title: 'a\u0000b\nc', description: 'l1\r\nl2\u0007' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.title).toBe('a b c');
    expect(r.value.description).toBe('l1\nl2');
  });
});

describe('projets, notes, paramètres', () => {
  it('valide les projets', () => {
    expect(validateProjectInput({ name: 'Travail', color: '#FF0000' })).toEqual({ ok: true, value: { name: 'Travail', color: '#ff0000' } });
    expect(validateProjectInput({ name: '' }).ok).toBe(false);
    expect(validateProjectInput({ name: 'x', color: 'rouge' }).ok).toBe(false);
  });

  it('valide les notes', () => {
    expect(validateNoteInput({ content: 'hello' })).toEqual({ ok: true, value: { content: 'hello' } });
    expect(validateNoteInput({ content: 3 }).ok).toBe(false);
  });

  it('valide les raccourcis clavier', () => {
    expect(isValidAccelerator('CommandOrControl+Alt+N')).toBe(true);
    expect(isValidAccelerator('Ctrl+Shift+F5')).toBe(true);
    expect(isValidAccelerator('Ctrl+Space')).toBe(true);
    expect(isValidAccelerator('N')).toBe(false);
    expect(isValidAccelerator('Ctrl+Ctrl+N')).toBe(false);
    expect(isValidAccelerator('Ctrl+Truc')).toBe(false);
  });

  it('valide les mises à jour partielles des paramètres', () => {
    expect(validateSettingsPatch({ theme: 'dark', widgetOpacity: 0.7 })).toEqual({ ok: true, value: { theme: 'dark', widgetOpacity: 0.7 } });
    expect(validateSettingsPatch({ theme: 'bleu' }).ok).toBe(false);
    expect(validateSettingsPatch({ inconnu: true }).ok).toBe(false);
    expect(validateSettingsPatch({ widgetOpacity: 0.1 }).ok).toBe(false);
    expect(validateSettingsPatch({ shortcuts: { quickAdd: 'N', toggleWidgets: '', openDashboard: '' } }).ok).toBe(false);
  });

  it('répare des paramètres stockés corrompus', () => {
    const s = sanitizeStoredSettings({ theme: 'violet', widgetOpacity: 0.5, shortcuts: { quickAdd: 'Alt+Q' } }, DEFAULT_SETTINGS);
    expect(s.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(s.widgetOpacity).toBe(0.5);
    expect(s.shortcuts.quickAdd).toBe('Alt+Q');
    expect(s.shortcuts.toggleWidgets).toBe(DEFAULT_SETTINGS.shortcuts.toggleWidgets);
  });
});
