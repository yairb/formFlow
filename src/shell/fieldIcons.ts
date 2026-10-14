import { AlignLeft, CalendarDays, CircleDot, PenLine, Signature, SquareCheck, StickyNote, TextCursorInput, type LucideIcon } from 'lucide-react';
import type { FieldKind } from '@/model/types';

export const FIELD_KIND_ICONS: Record<FieldKind, LucideIcon> = {
  text: TextCursorInput,
  multiline: AlignLeft,
  checkbox: SquareCheck,
  radio: CircleDot,
  date: CalendarDays,
  signature: Signature,
  drawing: PenLine,
  annotation: StickyNote,
};
