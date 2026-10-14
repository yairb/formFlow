import type { FieldKind } from '@/model/types';
import type { Rect } from '@/pdf/geometry';

/**
 * Ground truth for generated fixture forms: where a person would actually write.
 * Rects are display space (points, top-left origin). Used only by tests and the
 * detection evaluation script — never at runtime.
 */
export interface TruthField {
  pageIndex: number;
  rect: Rect;
  kind: FieldKind;
  label: string;
}

export class TruthRecorder {
  readonly fields: TruthField[] = [];
  page = 0;
  add(kind: FieldKind, label: string, rect: Rect): void {
    this.fields.push({ pageIndex: this.page, kind, label, rect });
  }
  /** The writing area above an underline from x1 to x2 at display y. */
  line(kind: FieldKind, label: string, x1: number, x2: number, y: number, height = 16): void {
    this.add(kind, label, { x: x1, y: y - height, width: x2 - x1, height });
  }
}
