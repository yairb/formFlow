import type { Rect } from '@/pdf/geometry';
import type { DocFontFamily } from '@/text/fonts';

export type AnnotationId = string;
export type FieldId = string;

export type TextAlign = 'left' | 'center' | 'right';

export type DateFormat = 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD' | 'D MMMM YYYY' | 'MMMM D, YYYY' | 'DD.MM.YYYY';

interface AnnotationBase {
  id: AnnotationId;
  pageIndex: number;
  /** Bounding box in display space (PDF points, top-left origin, rotation applied). */
  rect: Rect;
  /** Set when the annotation is the value of a form field. */
  fieldId?: FieldId;
}

export interface TextAnnotation extends AnnotationBase {
  type: 'text';
  text: string;
  fontSize: number;
  fontFamily: DocFontFamily;
  bold: boolean;
  color: string;
  align: TextAlign;
  /** When true the box hugs its content; otherwise text wraps at rect.width. */
  autoWidth: boolean;
  /** Present for date annotations: the structured value the text was generated from. */
  date?: { iso: string; format: DateFormat };
}

export type MarkKind = 'check' | 'cross' | 'dot';

export interface MarkAnnotation extends AnnotationBase {
  type: 'mark';
  mark: MarkKind;
  color: string;
}

export interface SignatureImage {
  /** PNG data URL with transparent background. */
  dataUrl: string;
  /** Intrinsic pixel size, used to preserve aspect ratio. */
  pixelWidth: number;
  pixelHeight: number;
}

export interface SignatureAnnotation extends AnnotationBase {
  type: 'signature';
  image: SignatureImage;
  signatureId?: string;
}

/** Stroke points are normalized to the annotation rect (0..1), so resizing scales them. */
export interface InkStroke {
  points: [number, number][];
}

export interface InkAnnotation extends AnnotationBase {
  type: 'ink';
  strokes: InkStroke[];
  color: string;
  /** Stroke width in points. */
  strokeWidth: number;
}

export interface HighlightAnnotation extends AnnotationBase {
  type: 'highlight';
  color: string;
  opacity: number;
}

export type Annotation =
  | TextAnnotation
  | MarkAnnotation
  | SignatureAnnotation
  | InkAnnotation
  | HighlightAnnotation;

export type AnnotationType = Annotation['type'];

// ---------------------------------------------------------------------------
// Form fields (native AcroForm fields and detected candidates)
// ---------------------------------------------------------------------------

export type FieldKind =
  | 'text'
  | 'multiline'
  | 'checkbox'
  | 'radio'
  | 'date'
  | 'signature'
  | 'drawing'
  | 'annotation';

export type DetectionSource = 'acroform' | 'text' | 'visual' | 'manual';

export type FieldReview = 'suggested' | 'accepted' | 'rejected';

/** Visual form of the target area — drives default value placement. */
export type FieldShape = 'line' | 'box' | 'square' | 'circle';

export interface NativeFieldInfo {
  /** Fully qualified AcroForm field name. */
  name: string;
  /** pdf.js annotation id of this widget (key into pdf.js annotation storage). */
  annotationId: string;
  /** pdf.js fieldType: Tx, Btn, Ch, Sig */
  fieldType: string;
  readOnly: boolean;
  /**
   * Value present in the file when it was opened. For checkboxes and radio widgets
   * this is the field's state name ('Off' when unchecked).
   */
  originalValue: string;
  /** For checkboxes / radio widgets: the state name this widget represents when on. */
  exportValue?: string;
  options?: string[];
  multiline?: boolean;
  maxLength?: number;
}

export interface FormField {
  id: FieldId;
  pageIndex: number;
  rect: Rect;
  kind: FieldKind;
  shape: FieldShape;
  label: string | null;
  /** 0..1 — how likely it is that this really is a place to fill in. */
  confidence: number;
  sources: DetectionSource[];
  review: FieldReview;
  skipped: boolean;
  notApplicable: boolean;
  /** Text direction suggested by the field's label. */
  rtl: boolean;
  native?: NativeFieldInfo;
  /** Short human-readable reasons, e.g. "blank line", "label: Name". */
  signals: string[];
}

export type FieldStatus = 'empty' | 'filled' | 'skipped' | 'na';

export interface DocModel {
  annotations: Record<AnnotationId, Annotation>;
  /** z-order, bottom to top */
  annotationOrder: AnnotationId[];
  fields: Record<FieldId, FormField>;
  /** Guided-filling order */
  fieldOrder: FieldId[];
}

export const EMPTY_MODEL: DocModel = {
  annotations: {},
  annotationOrder: [],
  fields: {},
  fieldOrder: [],
};
