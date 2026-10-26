import { describe, expect, it } from 'vitest';
import {
  addDays,
  diffDays,
  formatDayLabel,
  formatDue,
  formatOffset,
  formatRelative,
  isValidDateKey,
  isValidLocalDateTime,
  isValidTimeKey,
  startOfWeek,
  weekdayMondayFirst,
} from '../../src/shared/dates';
import { NOW } from '../helpers/factory';

describe('dates', () => {
  it('valide les dates réelles uniquement', () => {
    expect(isValidDateKey('2026-02-28')).toBe(true);
    expect(isValidDateKey('2026-02-29')).toBe(false);
    expect(isValidDateKey('2028-02-29')).toBe(true);
    expect(isValidDateKey('2026-13-01')).toBe(false);
    expect(isValidDateKey('26-10-2026')).toBe(false);
    expect(isValidDateKey(42)).toBe(false);
  });

  it('valide les heures et dates-heures', () => {
    expect(isValidTimeKey('00:00')).toBe(true);
    expect(isValidTimeKey('23:59')).toBe(true);
    expect(isValidTimeKey('24:00')).toBe(false);
    expect(isValidTimeKey('9:00')).toBe(false);
    expect(isValidLocalDateTime('2026-10-26T14:30')).toBe(true);
    expect(isValidLocalDateTime('2026-10-26 14:30')).toBe(false);
  });

  it('calcule les jours sans être perturbé par le changement d’heure', () => {
    // Passage à l'heure d'hiver le 25 octobre 2026 en Europe.
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(diffDays('2026-10-20', '2026-10-27')).toBe(7);
    expect(diffDays('2026-10-27', '2026-10-20')).toBe(-7);
  });

  it('gère les semaines commençant le lundi', () => {
    expect(weekdayMondayFirst('2026-10-26')).toBe(0); // lundi
    expect(weekdayMondayFirst('2026-11-01')).toBe(6); // dimanche
    expect(startOfWeek('2026-10-29')).toBe('2026-10-26');
  });

  it('produit des libellés de jour en français', () => {
    expect(formatDayLabel('2026-10-26', NOW)).toBe("Aujourd'hui");
    expect(formatDayLabel('2026-10-27', NOW)).toBe('Demain');
    expect(formatDayLabel('2026-10-25', NOW)).toBe('Hier');
    expect(formatDayLabel('2026-10-28', NOW)).toBe('Après-demain');
    expect(formatDayLabel('2026-10-29', NOW)).toBe('Jeudi');
    expect(formatDayLabel('2026-11-12', NOW)).toMatch(/12 nov/);
    expect(formatDue('2026-10-27', '14:30', NOW)).toBe('Demain · 14:30');
    expect(formatDue(null, null, NOW)).toBe('Sans échéance');
  });

  it('formate les durées relatives et les décalages de rappel', () => {
    expect(formatRelative(new Date(NOW.getTime() + 15 * 60_000), NOW)).toBe('dans 15 min');
    expect(formatRelative(new Date(NOW.getTime() - 3 * 3_600_000), NOW)).toBe('il y a 3 h');
    expect(formatRelative(new Date(NOW.getTime() + 2 * 86_400_000), NOW)).toBe('dans 2 j');
    expect(formatOffset(0)).toBe("À l'échéance");
    expect(formatOffset(15)).toBe('15 min avant');
    expect(formatOffset(90)).toBe('1 h 30 avant');
    expect(formatOffset(1440)).toBe('1 jour avant');
    expect(formatOffset(10080)).toBe('1 semaine avant');
  });
});
