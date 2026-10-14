import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { BRAND } from '@/brand';
import { DEFAULT_INK_COLOR, DEFAULT_TEXT_COLOR } from '@/model/annotations';
import { defaultDateFormat } from '@/model/dates';
import type { FillDefaults } from '@/model/fields';
import type { DateFormat } from '@/model/types';
import type { DocFontFamily } from '@/text/fonts';

export type ThemePref = 'system' | 'light' | 'dark';

export interface Prefs {
  theme: ThemePref;
  fontFamily: DocFontFamily;
  fontSize: number;
  textColor: string;
  markColor: string;
  inkColor: string;
  inkWidth: number;
  highlightColor: string;
  dateFormat: DateFormat;
  showFieldOverlays: boolean;
  showThumbnails: boolean;
  showInspector: boolean;
}

interface PrefsState extends Prefs {
  set(patch: Partial<Prefs>): void;
}

export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      theme: 'system',
      fontFamily: 'sans',
      fontSize: 11,
      textColor: DEFAULT_TEXT_COLOR,
      markColor: DEFAULT_TEXT_COLOR,
      inkColor: DEFAULT_INK_COLOR,
      inkWidth: 1.6,
      highlightColor: '#ffd94a',
      dateFormat: defaultDateFormat(),
      showFieldOverlays: true,
      showThumbnails: true,
      showInspector: true,
      set: (patch) => set(patch),
    }),
    {
      name: `${BRAND.storagePrefix}:prefs`,
      version: 1,
      partialize: ({ set: _set, ...rest }) => rest,
    },
  ),
);

export const prefs = () => usePrefs.getState();

export function fillDefaults(p: Prefs = prefs()): FillDefaults {
  return { fontFamily: p.fontFamily, color: p.textColor, dateFormat: p.dateFormat, maxFontSize: 12 };
}
