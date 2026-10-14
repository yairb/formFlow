import type { Rect } from '@/pdf/geometry';
import { addAnnotation, createMarkAnnotation, fitImageRect, fitTextAnnotation, layoutTextAnnotation, removeAnnotations, updateAnnotation, DEFAULT_TEXT_COLOR } from './annotations';
import { formatDate, todayIso } from './dates';
import { newId } from './ids';
import type {
  Annotation,
  DateFormat,
  DocModel,
  FieldId,
  FieldKind,
  FieldStatus,
  FormField,
  InkAnnotation,
  InkStroke,
  SignatureImage,
  TextAnnotation,
} from './types';

export const UNCERTAIN_THRESHOLD = 0.6;

export const FIELD_KIND_LABELS: Record<FieldKind, string> = {
  text: 'Text',
  multiline: 'Paragraph',
  checkbox: 'Checkbox',
  radio: 'Choice',
  date: 'Date',
  signature: 'Signature',
  drawing: 'Drawing',
  annotation: 'Free annotation',
};

export function createManualField(pageIndex: number, rect: Rect, kind: FieldKind): FormField {
  const square = Math.abs(rect.width - rect.height) < Math.max(rect.width, rect.height) * 0.25;
  return {
    id: newId('fld'),
    pageIndex,
    rect,
    kind,
    shape: kind === 'checkbox' && square ? 'square' : 'box',
    label: null,
    confidence: 1,
    sources: ['manual'],
    review: 'accepted',
    skipped: false,
    notApplicable: false,
    rtl: false,
    signals: ['added manually'],
  };
}

export function isUncertain(f: FormField): boolean {
  return f.review !== 'accepted' && f.confidence < UNCERTAIN_THRESHOLD;
}

export function boundAnnotations(m: DocModel, fieldId: FieldId): Annotation[] {
  const out: Annotation[] = [];
  for (const id of m.annotationOrder) {
    const a = m.annotations[id];
    if (a?.fieldId === fieldId) out.push(a);
  }
  return out;
}

export function fieldHasValue(m: DocModel, f: FormField): boolean {
  return boundAnnotations(m, f.id).some((a) => (a.type === 'text' ? a.text.trim() !== '' : true));
}

export function fieldStatus(m: DocModel, f: FormField): FieldStatus {
  if (f.notApplicable) return 'na';
  if (fieldHasValue(m, f)) return 'filled';
  if (f.skipped) return 'skipped';
  return 'empty';
}

/** Fields that participate in guided filling, in navigation order. */
export function activeFields(m: DocModel): FormField[] {
  const out: FormField[] = [];
  for (const id of m.fieldOrder) {
    const f = m.fields[id];
    if (f && f.review !== 'rejected') out.push(f);
  }
  return out;
}

export interface FieldSummary {
  total: number;
  filled: number;
  remaining: number;
  skipped: number;
  na: number;
  uncertain: number;
}

export function summarizeFields(m: DocModel): FieldSummary {
  const s: FieldSummary = { total: 0, filled: 0, remaining: 0, skipped: 0, na: 0, uncertain: 0 };
  for (const f of activeFields(m)) {
    s.total++;
    const st = fieldStatus(m, f);
    if (st === 'filled') s.filled++;
    else if (st === 'skipped') s.skipped++;
    else if (st === 'na') s.na++;
    else s.remaining++;
    if (isUncertain(f) && st !== 'na') s.uncertain++;
  }
  return s;
}

// ---------------------------------------------------------------------------
// Field CRUD
// ---------------------------------------------------------------------------

export function setFields(m: DocModel, fields: FormField[], order?: FieldId[]): DocModel {
  const map: Record<FieldId, FormField> = {};
  for (const f of fields) map[f.id] = f;
  return { ...m, fields: map, fieldOrder: order ?? fields.map((f) => f.id) };
}

export function addField(m: DocModel, f: FormField, afterId?: FieldId | null): DocModel {
  let order = m.fieldOrder.filter((id) => id !== f.id);
  const idx = afterId ? order.indexOf(afterId) : -1;
  if (idx >= 0) order = [...order.slice(0, idx + 1), f.id, ...order.slice(idx + 1)];
  else order = insertInReadingOrder(m, order, f);
  return { ...m, fields: { ...m.fields, [f.id]: f }, fieldOrder: order };
}

function insertInReadingOrder(m: DocModel, order: FieldId[], f: FormField): FieldId[] {
  const key = (x: FormField) => x.pageIndex * 1e6 + (x.rect.y + x.rect.height / 2) * 100 + x.rect.x / 100;
  const k = key(f);
  const i = order.findIndex((id) => {
    const o = m.fields[id];
    return o ? key(o) > k : false;
  });
  return i === -1 ? [...order, f.id] : [...order.slice(0, i), f.id, ...order.slice(i)];
}

export function updateField(m: DocModel, id: FieldId, patch: Partial<FormField>): DocModel {
  const f = m.fields[id];
  if (!f) return m;
  return { ...m, fields: { ...m.fields, [id]: { ...f, ...patch } } };
}

/** Removes a field. Values already placed for it are kept as free annotations. */
export function removeField(m: DocModel, id: FieldId): DocModel {
  if (!m.fields[id]) return m;
  const fields = { ...m.fields };
  delete fields[id];
  let annotations = m.annotations;
  for (const a of boundAnnotations(m, id)) {
    if (annotations === m.annotations) annotations = { ...m.annotations };
    const copy = { ...a };
    delete copy.fieldId;
    annotations[a.id] = copy;
  }
  return { ...m, fields, annotations, fieldOrder: m.fieldOrder.filter((x) => x !== id) };
}

export function clearFieldValue(m: DocModel, id: FieldId): DocModel {
  return removeAnnotations(
    m,
    boundAnnotations(m, id).map((a) => a.id),
  );
}

// ---------------------------------------------------------------------------
// Filling values
// ---------------------------------------------------------------------------

export interface FillDefaults {
  fontFamily: TextAnnotation['fontFamily'];
  color: string;
  dateFormat: DateFormat;
  maxFontSize: number;
}

const FIELD_PAD = 2;
const MIN_FIT_FONT = 6;

function defaultFontSize(f: FormField, maxFont: number): number {
  if (f.kind === 'multiline') return Math.min(maxFont, 10);
  const h = f.shape === 'line' ? Math.max(f.rect.height, 14) : f.rect.height;
  return Math.max(MIN_FIT_FONT, Math.min(maxFont, Math.round(h * 0.62 * 2) / 2));
}

/** Positions a value text annotation inside a field. */
export function layoutFieldText(f: FormField, a: TextAnnotation): TextAnnotation {
  const multiline = f.kind === 'multiline';
  const width = Math.max(8, f.rect.width - FIELD_PAD * 2);
  let next: TextAnnotation = fitTextAnnotation({
    ...a,
    autoWidth: false,
    rect: { x: f.rect.x + FIELD_PAD, y: a.rect.y, width, height: a.rect.height },
  });
  // Single-line fields: shrink the font until the text fits on one line.
  if (!multiline) {
    while (next.fontSize > MIN_FIT_FONT && layoutTextAnnotation(next).lines.length > 1) {
      next = fitTextAnnotation({ ...next, fontSize: Math.max(MIN_FIT_FONT, next.fontSize - 0.5) });
    }
  }
  const h = next.rect.height;
  let y: number;
  if (multiline) y = f.rect.y + FIELD_PAD;
  else if (f.shape === 'line') y = f.rect.y + f.rect.height - h - 1;
  else y = f.rect.y + (f.rect.height - h) / 2;
  return { ...next, rect: { ...next.rect, y } };
}

export function setFieldText(
  m: DocModel,
  f: FormField,
  text: string,
  defaults: FillDefaults,
  date?: TextAnnotation['date'],
): DocModel {
  const existing = boundAnnotations(m, f.id).find((a): a is TextAnnotation => a.type === 'text');
  if (existing) {
    const fontSize = Math.max(existing.fontSize, defaultFontSize(f, defaults.maxFontSize));
    const relaid = layoutFieldText(f, { ...existing, text, date, fontSize });
    return updateAnnotation(m, existing.id, () => relaid);
  }
  if (text === '') return m;
  const fontSize = defaultFontSize(f, defaults.maxFontSize);
  const base: TextAnnotation = {
    id: newId('txt'),
    type: 'text',
    pageIndex: f.pageIndex,
    fieldId: f.id,
    rect: { x: f.rect.x, y: f.rect.y, width: f.rect.width, height: f.rect.height },
    text,
    fontSize,
    fontFamily: defaults.fontFamily,
    bold: false,
    color: defaults.color || DEFAULT_TEXT_COLOR,
    align: f.rtl ? 'right' : 'left',
    autoWidth: false,
    date,
  };
  return addAnnotation(m, layoutFieldText(f, base));
}

export function setFieldDate(m: DocModel, f: FormField, iso: string, format: DateFormat, defaults: FillDefaults): DocModel {
  return setFieldText(m, f, formatDate(iso, format), defaults, { iso, format });
}

export function setFieldChecked(m: DocModel, f: FormField, checked: boolean, color: string): DocModel {
  const bound = boundAnnotations(m, f.id);
  if (!checked) return removeAnnotations(m, bound.map((a) => a.id));
  if (bound.some((a) => a.type === 'mark')) return m;
  // Radio: un-check siblings sharing the same native group.
  let next = m;
  if (f.kind === 'radio' && f.native) {
    for (const other of Object.values(m.fields)) {
      if (other.id !== f.id && other.native?.name === f.native.name) {
        next = removeAnnotations(next, boundAnnotations(next, other.id).map((a) => a.id));
      }
    }
  }
  const side = Math.min(f.rect.width, f.rect.height) * (f.kind === 'radio' ? 0.62 : 0.86);
  const center = { x: f.rect.x + f.rect.width / 2, y: f.rect.y + f.rect.height / 2 };
  if (f.shape === 'line') center.x = f.rect.x + side / 2 + FIELD_PAD;
  const mark = createMarkAnnotation(f.pageIndex, center, f.kind === 'radio' || f.shape === 'circle' ? 'dot' : 'check', Math.max(6, side), color);
  return addAnnotation(next, { ...mark, fieldId: f.id });
}

export function setFieldSignature(m: DocModel, f: FormField, image: SignatureImage, signatureId?: string): DocModel {
  const cleared = clearFieldValue(m, f.id);
  // Signature lines usually leave room above the line; let the signature extend upwards.
  const box: Rect =
    f.shape === 'line'
      ? { x: f.rect.x, y: f.rect.y + f.rect.height - Math.max(f.rect.height, 34), width: Math.min(f.rect.width, 190), height: Math.max(f.rect.height, 34) }
      : { x: f.rect.x + FIELD_PAD, y: f.rect.y + FIELD_PAD, width: f.rect.width - FIELD_PAD * 2, height: f.rect.height - FIELD_PAD * 2 };
  const rect = fitImageRect(image.pixelWidth, image.pixelHeight, box, f.rtl ? 'right' : 'left', 'bottom');
  return addAnnotation(cleared, {
    id: newId('sig'),
    type: 'signature',
    pageIndex: f.pageIndex,
    fieldId: f.id,
    rect,
    image,
    signatureId,
  });
}

/** Places strokes drawn on a pad (normalized 0..1 within a pad of aspect `padAspect`) into the field. */
export function setFieldDrawing(
  m: DocModel,
  f: FormField,
  strokes: InkStroke[],
  padAspect: number,
  color: string,
  strokeWidth: number,
): DocModel {
  const cleared = clearFieldValue(m, f.id);
  if (strokes.length === 0) return cleared;
  const box = { x: f.rect.x + FIELD_PAD, y: f.rect.y + FIELD_PAD, width: f.rect.width - FIELD_PAD * 2, height: f.rect.height - FIELD_PAD * 2 };
  const rect = fitImageRect(padAspect * 1000, 1000, box, 'center', 'center');
  const ink: InkAnnotation = { id: newId('ink'), type: 'ink', pageIndex: f.pageIndex, fieldId: f.id, rect, strokes, color, strokeWidth };
  return addAnnotation(cleared, ink);
}

const TEXTUAL: FieldKind[] = ['text', 'multiline', 'date'];

/**
 * Changes a field's kind. Text-like values survive conversions between text,
 * paragraph and date; other values are cleared (the change is undoable).
 */
export function changeFieldKind(m: DocModel, id: FieldId, kind: FieldKind, defaults: FillDefaults): DocModel {
  const f = m.fields[id];
  if (!f || f.kind === kind) return m;
  const nextField: FormField = { ...f, kind, review: 'accepted' };
  let next = updateField(m, id, { kind, review: 'accepted' });
  const bound = boundAnnotations(next, id);
  if (TEXTUAL.includes(f.kind) && TEXTUAL.includes(kind)) {
    const t = bound.find((a): a is TextAnnotation => a.type === 'text');
    if (t) {
      let text = t.text;
      let date = t.date;
      if (kind === 'date' && !date) {
        date = { iso: todayIso(), format: defaults.dateFormat };
        if (!text.trim()) text = formatDate(date.iso, date.format);
      }
      if (kind !== 'date') date = undefined;
      next = updateAnnotation(next, t.id, () => layoutFieldText(nextField, { ...t, text, date }));
    }
    return next;
  }
  return clearFieldValue(next, id);
}

/** Text value of a field (for text-like kinds), or '' when empty. */
export function fieldTextValue(m: DocModel, id: FieldId): string {
  const t = boundAnnotations(m, id).find((a): a is TextAnnotation => a.type === 'text');
  return t?.text ?? '';
}

export function fieldIsChecked(m: DocModel, id: FieldId): boolean {
  return boundAnnotations(m, id).some((a) => a.type === 'mark');
}
