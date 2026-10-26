import { describe, expect, it } from 'vitest';
import { parseQuickAdd } from '../../src/shared/quickParse';
import { NOW } from '../helpers/factory';

// NOW = lundi 26 octobre 2026, 10:00
describe('parseQuickAdd', () => {
  it('extrait date, heure, projet et priorité', () => {
    const r = parseQuickAdd('Appeler Paul demain 14h30 #Travail !urgent', NOW);
    expect(r).toMatchObject({
      title: 'Appeler Paul',
      dueDate: '2026-10-27',
      dueTime: '14:30',
      projectName: 'Travail',
      priority: 'urgent',
    });
    expect(r.matches.map((m) => m.kind).sort()).toEqual(['date', 'priority', 'project', 'time']);
  });

  it('laisse le texte simple intact', () => {
    const r = parseQuickAdd('Acheter du pain', NOW);
    expect(r).toMatchObject({ title: 'Acheter du pain', dueDate: null, dueTime: null, priority: null, projectName: null });
  });

  it('reconnaît les jours relatifs', () => {
    expect(parseQuickAdd("Sport aujourd'hui", NOW).dueDate).toBe('2026-10-26');
    expect(parseQuickAdd('Sport auj', NOW).dueDate).toBe('2026-10-26');
    expect(parseQuickAdd('Sport après-demain', NOW).dueDate).toBe('2026-10-28');
    expect(parseQuickAdd('Sport apres demain', NOW).dueDate).toBe('2026-10-28');
    expect(parseQuickAdd('Courses dans 3 jours', NOW).dueDate).toBe('2026-10-29');
    expect(parseQuickAdd('Bilan dans 2 semaines', NOW).dueDate).toBe('2026-11-09');
    expect(parseQuickAdd('Loyer dans 1 mois', NOW).dueDate).toBe('2026-11-26');
  });

  it('reconnaît les jours de la semaine (prochaine occurrence)', () => {
    expect(parseQuickAdd('Réunion vendredi', NOW).dueDate).toBe('2026-10-30');
    expect(parseQuickAdd('Réunion lundi', NOW).dueDate).toBe('2026-11-02'); // pas aujourd'hui
    expect(parseQuickAdd('Réunion mardi prochain', NOW).dueDate).toBe('2026-10-27');
    expect(parseQuickAdd('Plan semaine prochaine', NOW).dueDate).toBe('2026-11-02');
    expect(parseQuickAdd('Ranger ce week-end', NOW).dueDate).toBe('2026-10-31');
  });

  it('reconnaît les dates explicites', () => {
    expect(parseQuickAdd('Impôts 15/11', NOW).dueDate).toBe('2026-11-15');
    expect(parseQuickAdd('Impôts 15/11/2027', NOW).dueDate).toBe('2027-11-15');
    expect(parseQuickAdd('Anniversaire 3/02', NOW).dueDate).toBe('2027-02-03'); // déjà passé → an prochain
    expect(parseQuickAdd('Fête le 14 juillet', NOW).dueDate).toBe('2027-07-14');
    expect(parseQuickAdd('Rendez-vous 2 décembre', NOW).dueDate).toBe('2026-12-02');
    expect(parseQuickAdd('Facture le 30', NOW).dueDate).toBe('2026-10-30');
    expect(parseQuickAdd('Facture le 5', NOW).dueDate).toBe('2026-11-05');
    expect(parseQuickAdd('Date impossible 31/02', NOW).dueDate).toBeNull();
  });

  it('reconnaît les heures', () => {
    expect(parseQuickAdd('Dentiste à 9h', NOW).dueTime).toBe('09:00');
    expect(parseQuickAdd('Dentiste 9:15', NOW).dueTime).toBe('09:15');
    expect(parseQuickAdd('Déjeuner à midi', NOW).dueTime).toBe('12:00');
    expect(parseQuickAdd('Appel 18 h 45', NOW).dueTime).toBe('18:45');
    expect(parseQuickAdd('Pas une heure 25h', NOW).dueTime).toBeNull();
    expect(parseQuickAdd('Lire 2 heures', NOW).dueTime).toBeNull();
    const soir = parseQuickAdd('Appeler maman ce soir', NOW);
    expect(soir).toMatchObject({ title: 'Appeler maman', dueDate: '2026-10-26', dueTime: '19:00' });
  });

  it('reconnaît les priorités', () => {
    expect(parseQuickAdd('Tâche !haute', NOW).priority).toBe('high');
    expect(parseQuickAdd('Tâche !élevée', NOW).priority).toBe('high');
    expect(parseQuickAdd('Tâche !!', NOW).priority).toBe('high');
    expect(parseQuickAdd('Tâche !!!', NOW).priority).toBe('urgent');
    expect(parseQuickAdd('Tâche !faible', NOW).priority).toBe('low');
    expect(parseQuickAdd('Super !', NOW)).toMatchObject({ priority: null, title: 'Super !' });
    expect(parseQuickAdd('Tâche !inconnu', NOW).priority).toBeNull();
  });

  it('nettoie les mots de liaison orphelins', () => {
    expect(parseQuickAdd('Rapport pour demain', NOW).title).toBe('Rapport');
    expect(parseQuickAdd('Rappeler le client avant vendredi', NOW).title).toBe('Rappeler le client');
  });

  it('garde le texte original si tout a été interprété', () => {
    expect(parseQuickAdd('demain', NOW).title).toBe('demain');
  });

  it('accepte les projets avec accents et tirets', () => {
    expect(parseQuickAdd('Peindre #Maison-Été', NOW).projectName).toBe('Maison-Été');
  });
});
