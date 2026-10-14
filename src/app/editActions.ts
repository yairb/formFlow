import {
  addAnnotation,
  annotationLabel,
  appendInkStroke,
  createHighlightAnnotation,
  createInkAnnotation,
  createMarkAnnotation,
  createSignatureAnnotation,
  createTextAnnotation,
  duplicateAnnotation,
  fitImageRect,
  isEmptyAnnotation,
  moveAnnotationTo,
  removeAnnotations,
  simplifyStroke,
  updateAnnotation,
} from '@/model/annotations';
import { formatDate, todayIso } from '@/model/dates';
import { boundAnnotations, setFieldChecked, setFieldDate, setFieldSignature, setFieldText } from '@/model/fields';
import type { Annotation, AnnotationId, DocModel, FormField, InkAnnotation, MarkKind, TextAnnotation } from '@/model/types';
import { rectContains, type Point, type Rect, type Size } from '@/pdf/geometry';
import { documentState } from '@/state/document';
import { editor } from '@/state/editor';
import { fillDefaults, prefs } from '@/state/prefs';
import { activeSignature } from '@/state/signatures';
import { ui, type TextDraft } from '@/state/ui';

/**
 * Editing commands. Each one is a single undoable step with a human-readable label
 * ("Undo Move"), and all of them operate on display-space geometry.
 */

export const MARK_SIZE = 12;
const INK_JOIN_MS = 1400;
const INK_JOIN_DISTANCE = 40;

function pageSize(pageIndex: number): Size {
  const g = documentState().pdf?.pages[pageIndex];
  return g ? { width: g.width, height: g.height } : { width: 612, height: 792 };
}

function textDefaults() {
  const p = prefs();
  return { fontSize: p.fontSize, fontFamily: p.fontFamily, color: p.textColor };
}

/** The field (if any) under a point, preferring the smallest one. */
export function fieldAt(m: DocModel, pageIndex: number, p: Point, kinds?: FormField['kind'][]): FormField | null {
  let best: FormField | null = null;
  for (const id of m.fieldOrder) {
    const f = m.fields[id];
    if (!f || f.pageIndex !== pageIndex || f.review === 'rejected') continue;
    if (kinds && !kinds.includes(f.kind)) continue;
    if (f.native?.readOnly) continue;
    if (!rectContains(f.rect, p, 1.5)) continue;
    if (!best || f.rect.width * f.rect.height < best.rect.width * best.rect.height) best = f;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** Starts typing at a point: a UI-only draft that becomes an annotation on the first keystroke. */
export function startTextDraft(pageIndex: number, at: Point): void {
  const field = fieldAt(editor().model, pageIndex, at, ['text', 'multiline', 'date']);
  if (field) {
    editField(field);
    return;
  }
  ui().select([]);
  ui().setEditing({ kind: 'draft', draft: { pageIndex, at } });
}

/** Puts the caret into a text-like field, editing its existing value if there is one. */
export function editField(field: FormField): void {
  const m = editor().model;
  const existing = boundAnnotations(m, field.id).find((a) => a.type === 'text');
  ui().setActiveField(field.id);
  ui().select([]);
  if (existing) ui().setEditing({ kind: 'annotation', id: existing.id });
  else ui().setEditing({ kind: 'draft', draft: { pageIndex: field.pageIndex, at: { x: field.rect.x, y: field.rect.y }, fieldId: field.id } });
}

/** Applies typed text to a draft (creating the annotation) or to an existing annotation. */
export function applyText(target: { draft: TextDraft } | { id: AnnotationId }, text: string): AnnotationId | null {
  const ed = editor();
  if ('draft' in target) {
    const { draft } = target;
    if (text === '') return null;
    if (draft.fieldId) {
      const field = ed.model.fields[draft.fieldId];
      if (!field) return null;
      ed.commit('Fill field', (m) => setFieldText(m, field, text, fillDefaults()), { mergeKey: `field:${field.id}` });
      return boundAnnotations(editor().model, field.id).find((a) => a.type === 'text')?.id ?? null;
    }
    const a = createTextAnnotation(draft.pageIndex, draft.at, textDefaults(), { text });
    ed.commit('Add text', (m) => addAnnotation(m, a), { mergeKey: `type:${a.id}` });
    return a.id;
  }
  const a = ed.model.annotations[target.id];
  if (!a || a.type !== 'text' || a.text === text) return target.id;
  const field = a.fieldId ? ed.model.fields[a.fieldId] : undefined;
  if (field) {
    ed.commit('Fill field', (m) => setFieldText(m, field, text, fillDefaults(), a.date && text === a.text ? a.date : undefined), {
      mergeKey: `field:${field.id}`,
    });
  } else {
    ed.commit('Edit text', (m) => updateAnnotation(m, a.id, { text, date: undefined } as Partial<TextAnnotation>), {
      mergeKey: `type:${a.id}`,
    });
  }
  return a.id;
}

/**
 * Called when a text editor closes. An annotation left empty is removed; if it was
 * created during this same typing burst, the whole creation is discarded instead.
 */
export function finishText(id: AnnotationId): void {
  const ed = editor();
  const a = ed.model.annotations[id];
  if (!a || !isEmptyAnnotation(a)) return;
  const top = ed.past[ed.past.length - 1];
  if (top && !top.model.annotations[id] && ed.lastMerge?.key.endsWith(id)) {
    ed.discardLast();
    return;
  }
  ed.commit(a.fieldId ? 'Clear field' : 'Delete text', (m) => removeAnnotations(m, [id]));
}

// ---------------------------------------------------------------------------
// Marks, dates, signatures
// ---------------------------------------------------------------------------

export function placeMark(pageIndex: number, center: Point, mark: MarkKind): void {
  const m = editor().model;
  const field = fieldAt(m, pageIndex, center, ['checkbox', 'radio']);
  if (field) {
    const checked = boundAnnotations(m, field.id).some((a) => a.type === 'mark');
    editor().commit(checked ? 'Uncheck' : 'Check', (mm) => setFieldChecked(mm, field, !checked, prefs().markColor));
    ui().setActiveField(field.id);
    return;
  }
  const size = MARK_SIZE;
  const ps = pageSize(pageIndex);
  const c = { x: Math.min(Math.max(center.x, size / 2), ps.width - size / 2), y: Math.min(Math.max(center.y, size / 2), ps.height - size / 2) };
  const a = createMarkAnnotation(pageIndex, c, mark, size, prefs().markColor);
  editor().commit(mark === 'check' ? 'Add checkmark' : 'Add cross', (mm) => addAnnotation(mm, a));
  ui().select([a.id]);
}

export function placeDate(pageIndex: number, at: Point): void {
  const m = editor().model;
  const { dateFormat } = prefs();
  const iso = todayIso();
  const field = fieldAt(m, pageIndex, at, ['date', 'text']);
  if (field) {
    editor().commit('Fill date', (mm) => setFieldDate(mm, field, iso, dateFormat, fillDefaults()));
    ui().setActiveField(field.id);
    return;
  }
  const a = createTextAnnotation(pageIndex, at, textDefaults(), { text: formatDate(iso, dateFormat), date: { iso, format: dateFormat } });
  editor().commit('Add date', (mm) => addAnnotation(mm, a));
  ui().select([a.id]);
}

/** Places the active signature. Returns false when there is no signature yet. */
export function placeSignature(pageIndex: number, at: Point): boolean {
  const sig = activeSignature();
  if (!sig) return false;
  const m = editor().model;
  const field = fieldAt(m, pageIndex, at, ['signature']);
  if (field) {
    editor().commit('Sign', (mm) => setFieldSignature(mm, field, sig.image, sig.id));
    ui().setActiveField(field.id);
    return true;
  }
  const ps = pageSize(pageIndex);
  const width = 150;
  const height = 56;
  let rect = fitImageRect(sig.image.pixelWidth, sig.image.pixelHeight, { x: at.x - width / 2, y: at.y - height / 2, width, height });
  rect = { ...rect, x: Math.min(Math.max(0, rect.x), ps.width - rect.width), y: Math.min(Math.max(0, rect.y), ps.height - rect.height) };
  const a = createSignatureAnnotation(pageIndex, rect, sig.image, sig.id);
  editor().commit('Add signature', (mm) => addAnnotation(mm, a));
  ui().select([a.id]);
  return true;
}

// ---------------------------------------------------------------------------
// Ink and highlight
// ---------------------------------------------------------------------------

let lastInk: { id: AnnotationId; at: number; pageIndex: number } | null = null;

/** Adds a freehand stroke. Strokes drawn in quick succession nearby join one drawing. */
export function addInkStroke(pageIndex: number, raw: Point[]): void {
  const points = simplifyStroke(raw);
  if (points.length === 0) return;
  const { inkColor, inkWidth } = prefs();
  const m = editor().model;
  const prev = lastInk && m.annotations[lastInk.id];
  const now = Date.now();
  if (
    prev &&
    prev.type === 'ink' &&
    lastInk!.pageIndex === pageIndex &&
    now - lastInk!.at < INK_JOIN_MS &&
    prev.color === inkColor &&
    near(prev, points[0]!)
  ) {
    const id = prev.id;
    editor().commit('Draw', (mm) => updateAnnotation(mm, id, (a) => appendInkStroke(a as InkAnnotation, points)));
    lastInk = { id, at: now, pageIndex };
    return;
  }
  const a = createInkAnnotation(pageIndex, points, inkColor, inkWidth);
  editor().commit('Draw', (mm) => addAnnotation(mm, a));
  lastInk = { id: a.id, at: now, pageIndex };
}

function near(a: InkAnnotation, p: Point): boolean {
  const r = a.rect;
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.width));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.height));
  return Math.hypot(dx, dy) < INK_JOIN_DISTANCE;
}

export function placeHighlight(pageIndex: number, rect: Rect): void {
  if (rect.width < 3 || rect.height < 3) return;
  const a = createHighlightAnnotation(pageIndex, rect, prefs().highlightColor);
  editor().commit('Add highlight', (m) => addAnnotation(m, a));
}

// ---------------------------------------------------------------------------
// Selection commands
// ---------------------------------------------------------------------------

function selected(): Annotation[] {
  const m = editor().model;
  return ui()
    .selection.map((id) => m.annotations[id])
    .filter((a): a is Annotation => !!a);
}

export function deleteSelection(): void {
  const items = selected();
  if (items.length === 0) return;
  const label = items.length === 1 ? `Delete ${annotationLabel(items[0]!).toLowerCase()}` : `Delete ${items.length} items`;
  editor().commit(label, (m) => removeAnnotations(m, items.map((a) => a.id)));
  ui().select([]);
}

export function duplicateSelection(): void {
  const items = selected();
  if (items.length === 0) return;
  const ids: AnnotationId[] = [];
  editor().commit('Duplicate', (m) => {
    let next = m;
    for (const a of items) {
      const r = duplicateAnnotation(next, a.id, { x: 12, y: 12 }, pageSize(a.pageIndex));
      next = r.model;
      if (r.id) ids.push(r.id);
    }
    return next;
  });
  ui().select(ids);
}

export function nudgeSelection(dx: number, dy: number): void {
  const items = selected();
  if (items.length === 0) return;
  editor().commit(
    'Move',
    (m) => {
      let next = m;
      for (const a of items) next = moveAnnotationTo(next, a.id, { ...a.rect, x: a.rect.x + dx, y: a.rect.y + dy }, pageSize(a.pageIndex));
      return next;
    },
    { mergeKey: `nudge:${items.map((a) => a.id).join(',')}` },
  );
}

export function selectAllOnPage(pageIndex: number): void {
  const m = editor().model;
  ui().select(m.annotationOrder.filter((id) => m.annotations[id]?.pageIndex === pageIndex));
}

export function updateSelected(label: string, patch: (a: Annotation) => Annotation | null, mergeKey?: string): void {
  const items = selected();
  if (items.length === 0) return;
  editor().commit(
    label,
    (m) => {
      let next = m;
      for (const a of items) {
        const p = patch(a);
        if (p) next = updateAnnotation(next, a.id, () => p);
      }
      return next;
    },
    mergeKey ? { mergeKey } : undefined,
  );
}
