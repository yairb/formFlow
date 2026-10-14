import { boundAnnotations, fieldIsChecked, fieldTextValue } from './fields';
import type { DocModel, FormField } from './types';

/**
 * Native (AcroForm) fields are imported into the model with their current values,
 * so FormFlow is the only thing drawing their values on screen (pdf.js renders them
 * blank). On export, untouched fields are left exactly as they were in the file —
 * still interactive — and only fields whose value changed are replaced by flattened
 * FormFlow content.
 */
export function isManagedNative(f: FormField): f is FormField & { native: NonNullable<FormField['native']> } {
  return !!f.native && !f.native.readOnly && f.native.fieldType !== 'Sig';
}

export function isCheckable(f: FormField): boolean {
  return f.native?.fieldType === 'Btn';
}

export function nativeOriginallyChecked(f: FormField): boolean {
  const n = f.native;
  if (!n) return false;
  return n.originalValue !== '' && n.originalValue !== 'Off' && (n.exportValue === undefined || n.originalValue === n.exportValue);
}

export function isNativeFieldDirty(m: DocModel, f: FormField): boolean {
  if (!isManagedNative(f)) return false;
  if (isCheckable(f)) {
    const bound = boundAnnotations(m, f.id);
    if (bound.some((a) => a.type !== 'mark')) return true;
    return fieldIsChecked(m, f.id) !== nativeOriginallyChecked(f);
  }
  const bound = boundAnnotations(m, f.id);
  if (bound.some((a) => a.type !== 'text')) return true;
  return fieldTextValue(m, f.id) !== f.native.originalValue;
}

/** Fully qualified names of native fields that must be replaced on export. */
export function dirtyNativeFieldNames(m: DocModel): Set<string> {
  const names = new Set<string>();
  for (const id of m.fieldOrder) {
    const f = m.fields[id];
    if (f?.native && isNativeFieldDirty(m, f)) names.add(f.native.name);
  }
  return names;
}
