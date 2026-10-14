import type { DateFormat } from './types';

export const DATE_FORMATS: { id: DateFormat; example: string }[] = [
  { id: 'MM/DD/YYYY', example: '03/14/2026' },
  { id: 'DD/MM/YYYY', example: '14/03/2026' },
  { id: 'DD.MM.YYYY', example: '14.03.2026' },
  { id: 'YYYY-MM-DD', example: '2026-03-14' },
  { id: 'MMMM D, YYYY', example: 'March 14, 2026' },
  { id: 'D MMMM YYYY', example: '14 March 2026' },
];

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar date as ISO yyyy-mm-dd. */
export function todayIso(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function parseIsoDate(iso: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

export function formatDate(iso: string, format: DateFormat): string {
  const p = parseIsoDate(iso);
  if (!p) return iso;
  const { y, m, d } = p;
  switch (format) {
    case 'MM/DD/YYYY':
      return `${pad(m)}/${pad(d)}/${y}`;
    case 'DD/MM/YYYY':
      return `${pad(d)}/${pad(m)}/${y}`;
    case 'DD.MM.YYYY':
      return `${pad(d)}.${pad(m)}.${y}`;
    case 'YYYY-MM-DD':
      return `${y}-${pad(m)}-${pad(d)}`;
    case 'MMMM D, YYYY':
      return `${MONTHS[m - 1]} ${d}, ${y}`;
    case 'D MMMM YYYY':
      return `${d} ${MONTHS[m - 1]} ${y}`;
  }
}

/** A reasonable default format for the user's locale. */
export function defaultDateFormat(locale = typeof navigator !== 'undefined' ? navigator.language : 'en-US'): DateFormat {
  if (/^en-US|^en$/i.test(locale)) return 'MM/DD/YYYY';
  if (/^(de|ru|pl|cs|fi|nb|da|tr)/i.test(locale)) return 'DD.MM.YYYY';
  if (/^(sv|lt|zh|ja|ko|hu)/i.test(locale)) return 'YYYY-MM-DD';
  return 'DD/MM/YYYY';
}
