import { userBoxToDisplayRect, type PageGeometry, type PdfBox } from '@/pdf/geometry';
import type { PDFPageProxy } from '@/pdf/pdfjs';
import { setFieldChecked, setFieldText, type FillDefaults } from '@/model/fields';
import { newId } from '@/model/ids';
import { isManagedNative, nativeOriginallyChecked } from '@/model/native';
import type { DocModel, FieldKind, FormField, NativeFieldInfo } from '@/model/types';
import { containsRtl } from '@/text/bidi';

/** Subset of pdf.js widget annotation data that FormFlow uses. */
interface PdfjsWidget {
  annotationType: number;
  subtype?: string;
  id: string;
  fieldType?: string;
  fieldName?: string;
  fieldValue?: unknown;
  rect: number[];
  readOnly?: boolean;
  hidden?: boolean;
  multiLine?: boolean;
  maxLen?: number;
  checkBox?: boolean;
  radioButton?: boolean;
  pushButton?: boolean;
  exportValue?: string;
  buttonValue?: string;
  options?: { exportValue?: string; displayValue?: string }[];
  alternativeText?: string;
  noHTML?: boolean;
}

const WIDGET = 20;

function stringValue(v: unknown): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string').join(', ');
  return '';
}

/** Turns "applicant_first_name" / "ApplicantFirstName[0]" into "Applicant first name". */
export function humanizeFieldName(name: string): string {
  const last = name.split('.').pop() ?? name;
  const words = last
    .replace(/\[\d+\]/g, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!words || /^(text|field|check box|checkbox|untitled)\s*\d*$/i.test(words)) return '';
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

function kindFor(w: PdfjsWidget, label: string): FieldKind | null {
  switch (w.fieldType) {
    case 'Tx':
      if (w.multiLine) return 'multiline';
      if (/\b(date|dob|birth)\b|תאריך/i.test(label) || /date|dob/i.test(w.fieldName ?? '')) return 'date';
      return 'text';
    case 'Ch':
      return 'text';
    case 'Btn':
      if (w.pushButton) return null;
      return w.radioButton ? 'radio' : 'checkbox';
    case 'Sig':
      return 'signature';
    default:
      return null;
  }
}

/** Stage 1: native AcroForm widgets on one page, as FormFlow fields. */
export async function readNativeFields(page: PDFPageProxy, geom: PageGeometry): Promise<FormField[]> {
  const annots = (await page.getAnnotations({ intent: 'display' })) as PdfjsWidget[];
  const out: FormField[] = [];
  for (const w of annots) {
    if (w.annotationType !== WIDGET || w.hidden || !w.fieldName || w.rect.length !== 4) continue;
    const label = (w.alternativeText?.trim() || humanizeFieldName(w.fieldName)) ?? '';
    const kind = kindFor(w, label);
    if (!kind) continue;
    const rect = userBoxToDisplayRect(geom, w.rect as unknown as PdfBox);
    if (rect.width < 1 || rect.height < 1) continue;
    const isButton = w.fieldType === 'Btn';
    const native: NativeFieldInfo = {
      name: w.fieldName,
      annotationId: w.id,
      fieldType: w.fieldType ?? 'Tx',
      readOnly: !!w.readOnly,
      originalValue: isButton ? stringValue(w.fieldValue) || 'Off' : stringValue(w.fieldValue),
      exportValue: isButton ? (w.radioButton ? w.buttonValue : w.exportValue) : undefined,
      options: w.options?.map((o) => o.displayValue ?? o.exportValue ?? '').filter(Boolean),
      multiline: w.multiLine || undefined,
      maxLength: w.maxLen || undefined,
    };
    const square = Math.abs(rect.width - rect.height) <= Math.max(rect.width, rect.height) * 0.2;
    out.push({
      id: newId('fld'),
      pageIndex: geom.index,
      rect,
      kind,
      shape: w.radioButton ? 'circle' : isButton && square ? 'square' : 'box',
      label: label || null,
      confidence: 1,
      sources: ['acroform'],
      review: 'accepted',
      skipped: false,
      notApplicable: false,
      rtl: containsRtl(label),
      native,
      signals: [`form field “${w.fieldName}”`],
    });
  }
  return out;
}

/** Copies the values stored in the file into the model, so FormFlow draws them. */
export function importNativeValues(m: DocModel, defaults: FillDefaults): DocModel {
  let next = m;
  for (const id of m.fieldOrder) {
    const f = next.fields[id];
    if (!f || !isManagedNative(f)) continue;
    if (f.native.fieldType === 'Btn') {
      if (nativeOriginallyChecked(f)) next = setFieldChecked(next, f, true, defaults.color);
    } else if (f.native.originalValue) {
      next = setFieldText(next, f, f.native.originalValue, defaults);
    }
  }
  return next;
}
