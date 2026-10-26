// Utilitaires de dates en heure locale.
// Les échéances sont stockées sous forme de « clés » texte (AAAA-MM-JJ et HH:mm) pour éviter
// tout décalage de fuseau horaire ; les horodatages techniques sont en ISO (UTC).

const DAY_MS = 86_400_000;

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function todayKey(now: Date = new Date()): string {
  return toDateKey(now);
}

export function toTimeKey(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function toLocalDateTimeKey(d: Date): string {
  return `${toDateKey(d)}T${toTimeKey(d)}`;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATETIME_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/;

export function isValidDateKey(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1970 || y > 2999 || mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

export function isValidTimeKey(value: unknown): value is string {
  return typeof value === 'string' && TIME_RE.test(value);
}

export function isValidLocalDateTime(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = DATETIME_RE.exec(value);
  return !!m && isValidDateKey(m[1]) && isValidTimeKey(m[2]);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Minuit local de la date donnée. */
export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function combineDateTime(dateKey: string, time: string): Date {
  const [y, m, d] = dateKey.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

export function parseLocalDateTime(value: string): Date | null {
  if (!isValidLocalDateTime(value)) return null;
  const [date, time] = value.split('T');
  return combineDateTime(date, time);
}

function utcDays(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

export function addDays(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return toDateKey(new Date(y, m - 1, d + days));
}

/** Nombre de jours de `from` à `to` (positif si `to` est après). Insensible aux changements d'heure. */
export function diffDays(from: string, to: string): number {
  return Math.round(utcDays(to) - utcDays(from));
}

/** 0 = lundi … 6 = dimanche */
export function weekdayMondayFirst(key: string): number {
  return (parseDateKey(key).getDay() + 6) % 7;
}

export function startOfWeek(key: string): string {
  return addDays(key, -weekdayMondayFirst(key));
}

const weekdayFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long' });
const shortDateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const shortDateYearFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const longDateFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const weekdayShortFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' });

export function weekdayName(key: string): string {
  return weekdayFmt.format(parseDateKey(key));
}

export function weekdayShort(key: string): string {
  return weekdayShortFmt.format(parseDateKey(key)).replace('.', '');
}

export function formatLongDate(key: string): string {
  const s = longDateFmt.format(parseDateKey(key));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function formatShortDate(key: string, now: Date = new Date()): string {
  const d = parseDateKey(key);
  return d.getFullYear() === now.getFullYear() ? shortDateFmt.format(d) : shortDateYearFmt.format(d);
}

/** « Aujourd'hui », « Demain », « Hier », « jeudi », « 12 nov. » … */
export function formatDayLabel(key: string, now: Date = new Date()): string {
  const diff = diffDays(todayKey(now), key);
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return 'Demain';
  if (diff === -1) return 'Hier';
  if (diff === 2) return 'Après-demain';
  if (diff > 2 && diff < 7) {
    const w = weekdayName(key);
    return w.charAt(0).toUpperCase() + w.slice(1);
  }
  return formatShortDate(key, now);
}

/** Libellé d'échéance complet : « Demain · 14:30 ». */
export function formatDue(dueDate: string | null, dueTime: string | null, now: Date = new Date()): string {
  if (!dueDate) return 'Sans échéance';
  const day = formatDayLabel(dueDate, now);
  return dueTime ? `${day} · ${dueTime}` : day;
}

/** « dans 15 min », « dans 2 h », « il y a 3 j » … */
export function formatRelative(target: Date, now: Date = new Date()): string {
  const deltaMin = Math.round((target.getTime() - now.getTime()) / 60_000);
  const abs = Math.abs(deltaMin);
  let unit: string;
  if (abs < 1) return "à l'instant";
  if (abs < 60) unit = `${abs} min`;
  else if (abs < 60 * 24) {
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    unit = m && h < 5 ? `${h} h ${pad2(m)}` : `${h} h`;
  } else unit = `${Math.round(abs / (60 * 24))} j`;
  return deltaMin > 0 ? `dans ${unit}` : `il y a ${unit}`;
}

/** Durée lisible pour un décalage de rappel : 0 → « À l'échéance », 90 → « 1 h 30 avant ». */
export function formatOffset(minutes: number): string {
  if (minutes === 0) return "À l'échéance";
  if (minutes % 10080 === 0) {
    const w = minutes / 10080;
    return `${w} semaine${w > 1 ? 's' : ''} avant`;
  }
  if (minutes % 1440 === 0) {
    const d = minutes / 1440;
    return `${d} jour${d > 1 ? 's' : ''} avant`;
  }
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? `${h} h ${pad2(m)} avant` : `${h} h avant`;
  }
  return `${minutes} min avant`;
}

export function greeting(now: Date = new Date()): string {
  const h = now.getHours();
  if (h < 5) return 'Bonne nuit';
  if (h < 12) return 'Bonjour';
  if (h < 18) return 'Bon après-midi';
  return 'Bonsoir';
}
