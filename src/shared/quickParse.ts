// Saisie rapide en langage naturel (français).
// Exemple : « Appeler Paul demain 14h30 #Travail !urgent »
//   → titre « Appeler Paul », échéance demain à 14:30, projet « Travail », priorité urgente.
//
// Syntaxe reconnue :
//   Dates   : aujourd'hui, auj, demain, après-demain, ce soir, ce matin, cet après-midi, ce week-end,
//             lundi … dimanche (prochaine occurrence), semaine prochaine, dans 3 jours / 2 semaines / 1 mois,
//             15/11, 15/11/2026, 15 novembre, le 15
//   Heures  : 14h, 14h30, 14 h, 9:15, à midi (le « à » / « vers » qui précède est retiré)
//   Priorité: !urgent, !haute (ou !élevée, !important), !normale, !faible (ou !basse), !! (élevée), !!! (urgente)
//   Projet  : #NomDuProjet

import { addDays, daysInMonth, pad2, toDateKey, todayKey, weekdayMondayFirst } from './dates';
import type { Priority } from './types';

export interface ParsedQuickAdd {
  title: string;
  dueDate: string | null;
  dueTime: string | null;
  priority: Priority | null;
  projectName: string | null;
  /** Fragments reconnus, pour l'aperçu dans l'interface. */
  matches: { kind: 'date' | 'time' | 'priority' | 'project'; text: string }[];
}

const B = '(?<=^|[\\s,;(])';
const E = '(?=$|[\\s,;.!?)])';

const WEEKDAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const MONTHS: Record<string, number> = {
  janvier: 1,
  janv: 1,
  fevrier: 2,
  février: 2,
  fevr: 2,
  févr: 2,
  mars: 3,
  avril: 4,
  avr: 4,
  mai: 5,
  juin: 6,
  juillet: 7,
  juil: 7,
  aout: 8,
  août: 8,
  septembre: 9,
  sept: 9,
  octobre: 10,
  oct: 10,
  novembre: 11,
  nov: 11,
  decembre: 12,
  décembre: 12,
  dec: 12,
  déc: 12,
};

const PRIORITY_WORDS: Record<string, Priority> = {
  urgent: 'urgent',
  urgente: 'urgent',
  u: 'urgent',
  haute: 'high',
  haut: 'high',
  élevée: 'high',
  élevé: 'high',
  elevee: 'high',
  eleve: 'high',
  important: 'high',
  importante: 'high',
  h: 'high',
  normale: 'normal',
  normal: 'normal',
  n: 'normal',
  faible: 'low',
  basse: 'low',
  bas: 'low',
  f: 'low',
  b: 'low',
};

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Applique `handler` à la première correspondance acceptée et la retire du texte. */
function extractFirst(text: string, regex: RegExp, handler: (m: string[]) => boolean, onMatch: (raw: string) => void): string {
  let done = false;
  return text.replace(regex, (...args: unknown[]) => {
    const match = args[0] as string;
    if (done) return match;
    const groups = args.slice(0, -2).filter((a) => typeof a === 'string' || a === undefined) as string[];
    if (handler(groups)) {
      done = true;
      onMatch(match.trim());
      return ' ';
    }
    return match;
  });
}

function buildDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** Date sans année : cette année, ou l'an prochain si elle est déjà passée. */
function nextDate(month: number, day: number, now: Date): string | null {
  const today = todayKey(now);
  const y = now.getFullYear();
  const candidate = buildDate(y, month, day);
  if (candidate && candidate >= today) return candidate;
  return buildDate(y + 1, month, day);
}

export function parseQuickAdd(input: string, now: Date = new Date()): ParsedQuickAdd {
  const result: ParsedQuickAdd = {
    title: '',
    dueDate: null,
    dueTime: null,
    priority: null,
    projectName: null,
    matches: [],
  };
  let text = ` ${input.replace(/\s+/g, ' ').trim()} `;
  const today = todayKey(now);

  // Projet : #Nom
  text = extractFirst(
    text,
    new RegExp(`${B}#([\\p{L}\\p{N}_\\-]{1,60})${E}`, 'gu'),
    (g) => {
      result.projectName = g[1].replace(/[_]/g, ' ');
      return true;
    },
    (raw) => result.matches.push({ kind: 'project', text: raw }),
  );

  // Priorité : !urgent, !!, !!!
  text = extractFirst(
    text,
    new RegExp(`${B}(!{1,3})([\\p{L}]+)?${E}`, 'gu'),
    (g) => {
      const bangs = g[1].length;
      const word = g[2]?.toLowerCase();
      if (word) {
        const p = PRIORITY_WORDS[word];
        if (!p) return false;
        result.priority = p;
        return true;
      }
      if (bangs === 1) return false;
      result.priority = bangs >= 3 ? 'urgent' : 'high';
      return true;
    },
    (raw) => result.matches.push({ kind: 'priority', text: raw }),
  );

  // Heure : 14h, 14h30, 14:30, à midi
  text = extractFirst(
    text,
    new RegExp(`${B}(?:(?:à|a|vers)\\s+)?(?:(\\d{1,2})\\s?h\\s?(\\d{2})?|(\\d{1,2}):(\\d{2})|(midi))${E}`, 'giu'),
    (g) => {
      let h: number;
      let m: number;
      if (g[5]) {
        h = 12;
        m = 0;
      } else if (g[1] !== undefined) {
        h = Number(g[1]);
        m = g[2] !== undefined ? Number(g[2]) : 0;
      } else {
        h = Number(g[3]);
        m = Number(g[4]);
      }
      if (h > 23 || m > 59) return false;
      result.dueTime = `${pad2(h)}:${pad2(m)}`;
      return true;
    },
    (raw) => result.matches.push({ kind: 'time', text: raw }),
  );

  const setDate = (key: string | null): boolean => {
    if (!key) return false;
    result.dueDate = key;
    return true;
  };
  const onDate = (raw: string) => result.matches.push({ kind: 'date', text: raw });

  const dateRules: [RegExp, (g: string[]) => boolean][] = [
    [new RegExp(`${B}(?:pour\\s+)?apr[eè]s[-\\s]demain${E}`, 'giu'), () => setDate(addDays(today, 2))],
    [new RegExp(`${B}(?:pour\\s+)?(?:aujourd['’]?hui|auj)${E}`, 'giu'), () => setDate(today)],
    [new RegExp(`${B}(?:pour\\s+)?demain${E}`, 'giu'), () => setDate(addDays(today, 1))],
    [
      new RegExp(`${B}(ce\\s+soir|ce\\s+matin|cet\\s+apr[eè]s[-\\s]midi)${E}`, 'giu'),
      (g) => {
        const w = stripAccents(g[1].toLowerCase());
        if (!result.dueTime) result.dueTime = w.includes('soir') ? '19:00' : w.includes('matin') ? '09:00' : '14:00';
        return setDate(today);
      },
    ],
    [
      new RegExp(`${B}(?:ce\\s+)?week[-\\s]?end${E}`, 'giu'),
      () => {
        const wd = weekdayMondayFirst(today);
        return setDate(wd >= 5 ? today : addDays(today, 5 - wd));
      },
    ],
    [
      new RegExp(`${B}(?:la\\s+)?semaine\\s+prochaine${E}`, 'giu'),
      () => setDate(addDays(today, 7 - weekdayMondayFirst(today))),
    ],
    [
      new RegExp(`${B}dans\\s+(\\d{1,3})\\s*(jours?|j|semaines?|sem|mois)${E}`, 'giu'),
      (g) => {
        const n = Number(g[1]);
        const unit = g[2].toLowerCase();
        if (unit.startsWith('mois')) {
          const d = new Date(now.getFullYear(), now.getMonth() + n, 1);
          const day = Math.min(now.getDate(), daysInMonth(d.getFullYear(), d.getMonth() + 1));
          return setDate(toDateKey(new Date(d.getFullYear(), d.getMonth(), day)));
        }
        return setDate(addDays(today, unit.startsWith('s') ? n * 7 : n));
      },
    ],
    [
      new RegExp(`${B}(?:(?:ce|le|pour|d'ici)\\s+)?(${WEEKDAYS.join('|')})(?:\\s+prochain)?${E}`, 'giu'),
      (g) => {
        const target = WEEKDAYS.indexOf(g[1].toLowerCase());
        const delta = (target - weekdayMondayFirst(today) + 7) % 7 || 7;
        return setDate(addDays(today, delta));
      },
    ],
    [
      new RegExp(`${B}(?:le\\s+)?(\\d{1,2})/(\\d{1,2})(?:/(\\d{2}|\\d{4}))?${E}`, 'gu'),
      (g) => {
        const day = Number(g[1]);
        const month = Number(g[2]);
        if (g[3]) {
          const year = g[3].length === 2 ? 2000 + Number(g[3]) : Number(g[3]);
          return setDate(buildDate(year, month, day));
        }
        return setDate(nextDate(month, day, now));
      },
    ],
    [
      new RegExp(`${B}(?:le\\s+)?(\\d{1,2})(?:er)?\\s+(${Object.keys(MONTHS).join('|')})\\.?(?:\\s+(\\d{4}))?${E}`, 'giu'),
      (g) => {
        const day = Number(g[1]);
        const month = MONTHS[g[2].toLowerCase()];
        if (g[3]) return setDate(buildDate(Number(g[3]), month, day));
        return setDate(nextDate(month, day, now));
      },
    ],
    [
      new RegExp(`${B}le\\s+(\\d{1,2})(?:er)?${E}`, 'giu'),
      (g) => {
        const day = Number(g[1]);
        const month = now.getMonth() + 1;
        let key = buildDate(now.getFullYear(), month, day);
        if (!key || key < today) {
          const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
          key = buildDate(next.getFullYear(), next.getMonth() + 1, day);
        }
        return setDate(key);
      },
    ],
  ];

  for (const [regex, handler] of dateRules) {
    if (result.dueDate) break;
    text = extractFirst(text, regex, handler, onDate);
  }

  let title = text.replace(/\s+/g, ' ').trim();
  // Mots de liaison orphelins en fin de titre (« Rapport pour demain » → « Rapport »).
  const trailing = /\s+(?:à|a|le|la|pour|de|du|d'ici|avant|vers|ce|cet|cette|et)$/i;
  while (trailing.test(title)) title = title.replace(trailing, '').trim();
  title = title.replace(/^(?:et|à)\s+/i, '').trim();

  result.title = title || input.trim();
  return result;
}
