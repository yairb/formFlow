import { todayIso } from '@/model/dates';
import { boundAnnotations, changeFieldKind, clearFieldValue, FIELD_KIND_LABELS, removeField, setFieldChecked, setFieldDate, updateField } from '@/model/fields';
import type { FieldId, FieldKind, FormField } from '@/model/types';
import { firstOpenField, navigationList, nextOpenField, stepField } from '@/guided/navigation';
import { editor } from '@/state/editor';
import { fillDefaults, prefs } from '@/state/prefs';
import { activeSignature } from '@/state/signatures';
import { ui } from '@/state/ui';
import { editField, placeSignature } from './editActions';

/**
 * Field-level commands used by guided filling, the fields list and the inspector.
 * Each model change is one undoable step.
 */

const fieldName = (f: FormField) => (f.label ? `“${f.label}”` : FIELD_KIND_LABELS[f.kind].toLowerCase());

/** Selects a field, scrolls it to the center of the workspace and, when asked, starts filling it. */
export function focusField(id: FieldId | null, opts: { fill?: boolean; smooth?: boolean } = {}): void {
  const s = ui();
  if (!id) {
    s.setActiveField(null);
    return;
  }
  const f = editor().model.fields[id];
  if (!f) return;
  s.setEditing(null);
  s.select([]);
  s.setActiveField(id);
  s.setCurrentPage(f.pageIndex);
  s.requestScroll(f.pageIndex, f.rect, opts.smooth ?? true);
  if (opts.fill) startFilling(f);
}

/** Puts the user into the natural input for a field: a caret for text, the signature pad for signatures. */
export function startFilling(f: FormField): void {
  if (f.native?.readOnly) return;
  if (f.kind === 'text' || f.kind === 'multiline' || f.kind === 'date') {
    editField(f);
    return;
  }
  if (f.kind === 'signature' && boundAnnotations(editor().model, f.id).length === 0) {
    const at = { x: f.rect.x + f.rect.width / 2, y: f.rect.y + f.rect.height / 2 };
    if (activeSignature()) placeSignature(f.pageIndex, at);
    else ui().openDialog({ kind: 'signature', place: { pageIndex: f.pageIndex, at, fieldId: f.id } });
  }
}

/** Fills a date field with today's date in the preferred format. */
export function fillToday(id: FieldId): void {
  const f = editor().model.fields[id];
  if (!f || f.native?.readOnly) return;
  ui().setEditing(null);
  editor().commit('Fill date', (m) => setFieldDate(m, m.fields[id] ?? f, todayIso(), prefs().dateFormat, fillDefaults()));
}

export function startGuided(): void {
  const m = editor().model;
  const current = ui().activeFieldId;
  const id = current && m.fields[current] && m.fields[current]!.review !== 'rejected' ? current : firstOpenField(m);
  ui().setGuided(true);
  if (id) focusField(id, { fill: true });
}

export function stopGuided(): void {
  ui().setEditing(null);
  ui().setGuided(false);
}

/** Moves to the next/previous field. At the end of the list, opens the final review. */
export function stepGuided(direction: 1 | -1, opts: { fill?: boolean } = {}): void {
  const m = editor().model;
  const current = ui().activeFieldId;
  const fallback = current ? m.fieldOrder.indexOf(current) : -1;
  const next = stepField(m, current, direction, fallback);
  if (next) {
    focusField(next, { fill: opts.fill ?? true });
    return;
  }
  if (direction === 1) {
    ui().setEditing(null);
    const open = nextOpenField(m, current);
    if (open) {
      ui().flash('Last field — some fields are still empty');
      focusField(open, { fill: opts.fill ?? true });
    } else {
      ui().openDialog({ kind: 'review' });
    }
  } else {
    ui().flash('This is the first field');
  }
}

/** Called after Enter in a field's text box. */
export function afterFieldEnter(id: FieldId): void {
  ui().setActiveField(id);
  stepGuided(1);
}

export function skipField(id: FieldId): void {
  const f = editor().model.fields[id];
  if (!f) return;
  if (!f.skipped) editor().commit(`Skip ${fieldName(f)}`, (m) => updateField(m, id, { skipped: true }));
  if (ui().activeFieldId === id) stepGuided(1);
}

export function toggleNotApplicable(id: FieldId): void {
  const f = editor().model.fields[id];
  if (!f) return;
  const on = !f.notApplicable;
  editor().commit(on ? 'Mark not applicable' : 'Mark applicable', (m) => {
    let next = updateField(m, id, { notApplicable: on, skipped: false });
    if (on) next = clearFieldValue(next, id);
    return next;
  });
  if (on && ui().activeFieldId === id && ui().guided) stepGuided(1);
}

export function setFieldKind(id: FieldId, kind: FieldKind): void {
  const f = editor().model.fields[id];
  if (!f || f.kind === kind) return;
  editor().commit(`Change to ${FIELD_KIND_LABELS[kind].toLowerCase()}`, (m) => changeFieldKind(m, id, kind, fillDefaults()));
}

export function setFieldLabel(id: FieldId, label: string): void {
  const f = editor().model.fields[id];
  const next = label.trim() || null;
  if (!f || f.label === next) return;
  editor().commit('Rename field', (m) => updateField(m, id, { label: next }), { mergeKey: `label:${id}` });
}

export function acceptField(id: FieldId): void {
  const f = editor().model.fields[id];
  if (!f || f.review === 'accepted') return;
  editor().commit('Accept field', (m) => updateField(m, id, { review: 'accepted' }));
}

/** Rejecting hides a suggestion from guided filling and the page; it can be restored. */
export function rejectField(id: FieldId): void {
  const f = editor().model.fields[id];
  if (!f) return;
  if (f.native) {
    ui().flash('Form fields that belong to the PDF can be marked “not applicable” instead');
    return;
  }
  const wasActive = ui().activeFieldId === id;
  editor().commit('Dismiss suggestion', (m) => updateField(clearFieldValue(m, id), id, { review: 'rejected' }));
  if (wasActive) {
    if (ui().guided) stepGuided(1, { fill: false });
    else ui().setActiveField(null);
  }
}

export function restoreField(id: FieldId): void {
  editor().commit('Restore suggestion', (m) => updateField(m, id, { review: 'suggested' }));
}

export function acceptAllConfident(threshold: number): number {
  const m = editor().model;
  const ids = navigationList(m).filter((f) => f.review === 'suggested' && f.confidence >= threshold).map((f) => f.id);
  if (ids.length === 0) return 0;
  editor().commit(`Accept ${ids.length} fields`, (mm) => ids.reduce((acc, id) => updateField(acc, id, { review: 'accepted' }), mm));
  return ids.length;
}

export function clearField(id: FieldId): void {
  if (boundAnnotations(editor().model, id).length === 0) return;
  editor().commit('Clear field', (m) => clearFieldValue(m, id));
}

export function toggleFieldChecked(id: FieldId): void {
  const m = editor().model;
  const f = m.fields[id];
  if (!f) return;
  const checked = boundAnnotations(m, id).some((a) => a.type === 'mark');
  editor().commit(checked ? 'Uncheck' : 'Check', (mm) => setFieldChecked(mm, f, !checked, prefs().markColor));
}

export function deleteField(id: FieldId): void {
  const f = editor().model.fields[id];
  if (!f || f.native) return;
  const wasActive = ui().activeFieldId === id;
  editor().commit(`Remove field ${fieldName(f)}`, (m) => removeField(m, id));
  if (wasActive) ui().setActiveField(null);
}
