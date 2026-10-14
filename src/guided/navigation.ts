import { activeFields, fieldStatus } from '@/model/fields';
import type { DocModel, FieldId, FormField } from '@/model/types';

/**
 * Pure guided-navigation rules. Order is the model's `fieldOrder` (stable unless the
 * user changes it); fields marked "not applicable" are skipped when stepping.
 */
export function navigationList(m: DocModel): FormField[] {
  return activeFields(m);
}

export function stepField(
  m: DocModel,
  currentId: FieldId | null,
  direction: 1 | -1,
  /** Index the current field had before it disappeared (e.g. was deleted). */
  fallbackIndex = -1,
): FieldId | null {
  const list = navigationList(m);
  if (list.length === 0) return null;
  let idx = currentId ? list.findIndex((f) => f.id === currentId) : -1;
  if (idx === -1 && currentId && fallbackIndex >= 0) {
    // Current field vanished: the item now at its old index is "next".
    idx = direction === 1 ? fallbackIndex - 1 : fallbackIndex;
  } else if (idx === -1) {
    idx = direction === 1 ? -1 : list.length;
  }
  for (let i = idx + direction; i >= 0 && i < list.length; i += direction) {
    const f = list[i]!;
    if (!f.notApplicable) return f.id;
  }
  return null;
}

export function firstOpenField(m: DocModel): FieldId | null {
  const list = navigationList(m);
  const open = list.find((f) => fieldStatus(m, f) === 'empty');
  return open?.id ?? list.find((f) => !f.notApplicable)?.id ?? null;
}

export function nextOpenField(m: DocModel, currentId: FieldId | null): FieldId | null {
  const list = navigationList(m);
  const start = currentId ? list.findIndex((f) => f.id === currentId) : -1;
  for (let i = 1; i <= list.length; i++) {
    const f = list[(start + i + list.length) % list.length];
    if (f && f.id !== currentId && fieldStatus(m, f) === 'empty') return f.id;
  }
  return null;
}

export function fieldPosition(m: DocModel, id: FieldId | null): { index: number; total: number } {
  const list = navigationList(m);
  return { index: id ? list.findIndex((f) => f.id === id) : -1, total: list.length };
}
