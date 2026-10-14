import { BRAND } from '@/brand';
import {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRef,
  LineCapStyle,
  LineJoinStyle,
  appendBezierCurve,
  beginText,
  closePath,
  concatTransformationMatrix,
  drawObject,
  endText,
  fill,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  setFillingColor,
  setFontAndSize,
  setGraphicsState,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingColor,
  setTextMatrix,
  showText,
  stroke,
  cmyk,
  grayscale,
  rgb,
  type Color,
  type PDFFont,
  type PDFImage,
  type PDFOperator,
  type PDFPage,
  type PDFForm,
  type PDFField,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { createPageGeometry, type PageGeometry } from '@/pdf/geometry';
import { inkStrokesAbsolute, layoutTextAnnotation } from '@/model/annotations';
import { MARK_SHAPES, mapPath, smoothStrokePath, toCubic, type PathCommand } from '@/model/paths';
import { dirtyNativeFieldNames } from '@/model/native';
import type { Annotation, DocModel, HighlightAnnotation, InkAnnotation, MarkAnnotation, SignatureAnnotation, TextAnnotation } from '@/model/types';
import type { FontKey, FontLibrary } from '@/text/fonts';
import { baselineOffset, DOC_TEXT_FEATURES } from '@/text/metrics';
import { lineOffsetX, positionLineRuns } from '@/text/runs';

import { ExportError, type ExportWarning } from './errors';
export { ExportError, type ExportErrorCode, type ExportWarning } from './errors';

export interface ExportInput {
  /** The original, unmodified file. */
  bytes: Uint8Array;
  pages: PageGeometry[];
  model: DocModel;
  fonts: FontLibrary;
}

export interface ExportResult {
  bytes: Uint8Array;
  warnings: ExportWarning[];
}

/** Renders one page (display orientation) to an image, for the raster fallback. */
export type PageRasterizer = (pageIndex: number) => Promise<{ data: Uint8Array; format: 'png' | 'jpeg' }>;

/**
 * Writes the user's content into a copy of the original PDF.
 *
 * - Original page content, resources, links and untouched form fields are kept.
 * - Additions are drawn as regular page content (flattened), so every viewer shows
 *   them identically and they cannot be edited accidentally.
 * - All drawing happens in FormFlow's display space through one `cm` per annotation
 *   (display → PDF user space), the same matrix pdf.js uses on screen, so rotated
 *   and cropped pages need no special cases.
 */
export async function exportPdf(input: ExportInput): Promise<ExportResult> {
  let doc: PDFDocument;
  try {
    // pdf-lib's EncryptedPDFError doesn't survive `instanceof` (transpiled class),
    // so load leniently and check the flag instead.
    doc = await PDFDocument.load(input.bytes, { updateMetadata: false, ignoreEncryption: true });
  } catch (e) {
    throw new ExportError('unreadable', 'The original PDF could not be prepared for export.', e);
  }
  if (doc.isEncrypted) {
    throw new ExportError('encrypted', 'This PDF is encrypted, so its pages cannot be modified directly.');
  }
  const warnings: ExportWarning[] = [];
  const pages = doc.getPages();
  if (pages.length !== input.pages.length) {
    throw new ExportError('unreadable', 'The PDF structure differs from what was displayed (page count mismatch).');
  }

  const dirty = dirtyNativeFieldNames(input.model);
  if (dirty.size > 0) replaceNativeFields(doc, dirty, warnings);

  const writer = new ContentWriter(doc, input.fonts, warnings);
  for (const a of exportableAnnotations(input.model, dirty)) {
    const page = pages[a.pageIndex];
    const geom = input.pages[a.pageIndex];
    if (!page || !geom) continue;
    await writer.draw(page, geom, a);
  }
  writer.finish();

  try {
    const out = await doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
    return { bytes: out, warnings };
  } catch (e) {
    throw new ExportError('failed', 'Writing the PDF failed.', e);
  }
}

/**
 * Fallback for encrypted PDFs that pdf-lib cannot rewrite: builds a new PDF from
 * page images (rendered by pdf.js with the user's password) plus vector additions.
 * Text in the original pages is no longer selectable; the UI says so before export.
 */
export async function exportRasterPdf(
  input: ExportInput,
  rasterize: PageRasterizer,
  meta: { title?: string | null } = {},
): Promise<ExportResult> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  if (meta.title) doc.setTitle(meta.title);
  doc.setProducer(BRAND.name);
  const warnings: ExportWarning[] = [];
  const writer = new ContentWriter(doc, input.fonts, warnings);
  const flatPages: PageGeometry[] = [];
  for (const geom of input.pages) {
    const page = doc.addPage([geom.width, geom.height]);
    const img = await rasterize(geom.index);
    const image = img.format === 'png' ? await doc.embedPng(img.data) : await doc.embedJpg(img.data);
    page.drawImage(image, { x: 0, y: 0, width: geom.width, height: geom.height });
    flatPages.push(createPageGeometry(geom.index, [0, 0, geom.width, geom.height], 0));
  }
  const pages = doc.getPages();
  for (const a of exportableAnnotations(input.model, new Set())) {
    const page = pages[a.pageIndex];
    const geom = flatPages[a.pageIndex];
    if (page && geom) await writer.draw(page, geom, a);
  }
  writer.finish();
  return { bytes: await doc.save({ useObjectStreams: false }), warnings };
}

/** Annotations in z-order, minus values of native fields that stay untouched in the file. */
function exportableAnnotations(model: DocModel, dirtyNative: Set<string>): Annotation[] {
  const out: Annotation[] = [];
  for (const id of model.annotationOrder) {
    const a = model.annotations[id];
    if (!a) continue;
    const field = a.fieldId ? model.fields[a.fieldId] : undefined;
    if (field?.native && !field.native.readOnly && field.native.fieldType !== 'Sig' && !dirtyNative.has(field.native.name)) {
      continue;
    }
    if (a.type === 'text' && a.text.trim() === '') continue;
    out.push(a);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

class ContentWriter {
  private fonts = new Map<FontKey, PDFFont>();
  private images = new Map<string, PDFImage>();
  private missing = new Set<string>();
  private resourceNames = new WeakMap<PDFPage, Map<string, PDFName>>();

  constructor(
    private readonly doc: PDFDocument,
    private readonly lib: FontLibrary,
    private readonly warnings: ExportWarning[],
  ) {
    doc.registerFontkit(fontkit as unknown as Parameters<PDFDocument['registerFontkit']>[0]);
  }

  finish(): void {
    if (this.missing.size > 0) this.warnings.push({ kind: 'missing-glyphs', characters: [...this.missing] });
  }

  async draw(page: PDFPage, geom: PageGeometry, a: Annotation): Promise<void> {
    let ops: PDFOperator[];
    switch (a.type) {
      case 'text':
        ops = await this.textOps(page, a);
        break;
      case 'mark':
        ops = markOps(a);
        break;
      case 'ink':
        ops = inkOps(a);
        break;
      case 'highlight':
        ops = this.highlightOps(page, a);
        break;
      case 'signature':
        ops = await this.signatureOps(page, a);
        break;
    }
    if (ops.length === 0) return;
    const [m0, m1, m2, m3, m4, m5] = geom.toUser;
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(m0, m1, m2, m3, m4, m5), ...ops, popGraphicsState());
  }

  private async font(key: FontKey): Promise<PDFFont> {
    let f = this.fonts.get(key);
    if (!f) {
      // Embedded whole: fontkit's subsetter emits glyph data that Apple's PDF engine
      // (Preview, Safari, Quick Look) can't draw, so most characters vanish there.
      f = await this.doc.embedFont(this.lib.getBytes(key), { subset: false, features: DOC_TEXT_FEATURES });
      this.fonts.set(key, f);
    }
    return f;
  }

  private resourceName(page: PDFPage, key: string, create: () => PDFName): PDFName {
    let names = this.resourceNames.get(page);
    if (!names) {
      names = new Map();
      this.resourceNames.set(page, names);
    }
    let name = names.get(key);
    if (!name) {
      name = create();
      names.set(key, name);
    }
    return name;
  }

  private async textOps(page: PDFPage, a: TextAnnotation): Promise<PDFOperator[]> {
    for (const ch of this.lib.unsupportedCharacters(a.text, a.fontFamily, a.bold)) this.missing.add(ch);
    const layout = layoutTextAnnotation(a, this.lib);
    const ops: PDFOperator[] = [setFillingColor(parseColor(a.color)), beginText()];
    const base = baselineOffset(a.fontSize);
    for (let i = 0; i < layout.lines.length; i++) {
      const line = layout.lines[i]!;
      if (!line.text.trim()) continue;
      const y = a.rect.y + i * layout.lineHeight + base;
      const x0 = a.rect.x + lineOffsetX(a.align, a.rect.width, line.width);
      for (const run of positionLineRuns(line, a.fontFamily, a.bold, a.fontSize, this.lib)) {
        if (!run.text.trim()) continue;
        const font = await this.font(run.face);
        const name = this.resourceName(page, `font:${run.face}`, () => page.node.newFontDictionary(font.name, font.ref));
        // Text matrix flips y back (display space is y-down) so glyphs stand upright.
        ops.push(setFontAndSize(name, a.fontSize), setTextMatrix(1, 0, 0, -1, x0 + run.x, y), showText(font.encodeText(run.text)));
      }
    }
    ops.push(endText());
    return ops;
  }

  private highlightOps(page: PDFPage, a: HighlightAnnotation): PDFOperator[] {
    const gs = this.resourceName(page, `hl:${a.opacity}`, () =>
      page.node.newExtGState(
        'GS',
        this.doc.context.obj({ Type: 'ExtGState', ca: a.opacity, CA: a.opacity, BM: 'Multiply' }),
      ),
    );
    const { x, y, width, height } = a.rect;
    return [setGraphicsState(gs), setFillingColor(parseColor(a.color)), rectangle(x, y, width, height), fill()];
  }

  private async signatureOps(page: PDFPage, a: SignatureAnnotation): Promise<PDFOperator[]> {
    let image = this.images.get(a.image.dataUrl);
    if (!image) {
      const { data, format } = decodeDataUrl(a.image.dataUrl);
      image = format === 'png' ? await this.doc.embedPng(data) : await this.doc.embedJpg(data);
      this.images.set(a.image.dataUrl, image);
    }
    const img = image;
    const name = this.resourceName(page, `img:${a.image.dataUrl.length}:${a.image.dataUrl.slice(-48)}`, () =>
      page.node.newXObject('Image', img.ref),
    );
    const { x, y, width, height } = a.rect;
    // Image space is a unit square with y up; flip it into y-down display space.
    return [pushGraphicsState(), concatTransformationMatrix(width, 0, 0, -height, x, y + height), drawObject(name), popGraphicsState()];
  }
}

function pathOps(path: PathCommand[]): PDFOperator[] {
  const ops: PDFOperator[] = [];
  for (const c of toCubic(path)) {
    switch (c.op) {
      case 'M':
        ops.push(moveTo(c.p.x, c.p.y));
        break;
      case 'L':
        ops.push(lineTo(c.p.x, c.p.y));
        break;
      case 'C':
        ops.push(appendBezierCurve(c.c1.x, c.c1.y, c.c2.x, c.c2.y, c.p.x, c.p.y));
        break;
      case 'Z':
        ops.push(closePath());
        break;
      case 'Q':
        break; // converted by toCubic
    }
  }
  return ops;
}

function markOps(a: MarkAnnotation): PDFOperator[] {
  const shape = MARK_SHAPES[a.mark];
  const { x, y, width, height } = a.rect;
  const size = Math.min(width, height);
  const color = parseColor(a.color);
  const ops: PDFOperator[] = [];
  if (shape.fill) ops.push(setFillingColor(color));
  else ops.push(setStrokingColor(color), setLineWidth(shape.strokeWidth * size), setLineCap(LineCapStyle.Round), setLineJoin(LineJoinStyle.Round));
  for (const p of shape.paths) {
    ops.push(...pathOps(mapPath(p, (pt) => ({ x: x + pt.x * width, y: y + pt.y * height }))));
    ops.push(shape.fill ? fill() : stroke());
  }
  return ops;
}

function inkOps(a: InkAnnotation): PDFOperator[] {
  const ops: PDFOperator[] = [
    setStrokingColor(parseColor(a.color)),
    setLineWidth(a.strokeWidth),
    setLineCap(LineCapStyle.Round),
    setLineJoin(LineJoinStyle.Round),
  ];
  for (const s of inkStrokesAbsolute(a)) {
    if (s.length === 0) continue;
    ops.push(...pathOps(smoothStrokePath(s)), stroke());
  }
  return ops;
}

// ---------------------------------------------------------------------------
// Native form fields
// ---------------------------------------------------------------------------

/**
 * Replaces the named AcroForm fields by their static look without a value
 * (background and border), then removes the fields. FormFlow draws the new
 * values on top, in its own fonts, so Unicode and RTL text export correctly.
 */
function replaceNativeFields(doc: PDFDocument, names: Set<string>, warnings: ExportWarning[]): void {
  let form: PDFForm;
  try {
    const hadXfa = doc.catalog.lookup(PDFName.of('AcroForm')) instanceof PDFDict &&
      (doc.catalog.lookup(PDFName.of('AcroForm')) as PDFDict).has(PDFName.of('XFA'));
    form = doc.getForm();
    if (hadXfa) warnings.push({ kind: 'xfa-removed' });
  } catch (e) {
    for (const fieldName of names) warnings.push({ kind: 'native-field', fieldName, message: describe(e) });
    return;
  }
  const pages = doc.getPages();
  for (const fieldName of names) {
    let field: PDFField | undefined;
    try {
      field = form.getFieldMaybe(fieldName);
      if (!field) throw new Error('field not found');
      const acro = field.acroField;
      for (const widget of acro.getWidgets()) {
        const widgetRef = doc.context.getObjectRef(widget.dict) ?? acro.ref;
        const page = pages.find((p) => annotsOf(p)?.indexOf(widgetRef) !== undefined) ?? pages.find((p) => p.ref === widget.P());
        if (!page) continue;
        if (!isHidden(widget.dict)) page.pushOperators(...staticWidgetOps(page, widget, acro.dict));
        const annots = annotsOf(page);
        const idx = annots?.indexOf(widgetRef);
        if (annots && idx !== undefined) annots.remove(idx);
        if (widgetRef !== acro.ref) doc.context.delete(widgetRef);
      }
      form.acroForm.removeField(acro);
      doc.context.delete(acro.ref);
    } catch (e) {
      warnings.push({ kind: 'native-field', fieldName, message: describe(e) });
    }
  }
}

function annotsOf(page: PDFPage) {
  return page.node.Annots();
}

function isHidden(dict: PDFDict): boolean {
  const f = dict.lookup(PDFName.of('F'));
  return f instanceof PDFNumber && (f.asNumber() & 2) !== 0;
}

type Widget = ReturnType<PDFField['acroField']['getWidgets']>[number];

function staticWidgetOps(page: PDFPage, widget: Widget, fieldDict: PDFDict): PDFOperator[] {
  const r = widget.getRectangle();
  // Checkboxes and radio buttons usually carry an explicit "Off" appearance.
  const ft = fieldDict.lookup(PDFName.of('FT')) ?? widget.dict.lookup(PDFName.of('FT'));
  const ap = widget.getNormalAppearance();
  if (ft === PDFName.of('Btn') && ap instanceof PDFDict) {
    const off = ap.get(PDFName.of('Off'));
    if (off instanceof PDFRef) {
      const name = page.node.newXObject('FlatWidget', off);
      return [pushGraphicsState(), concatTransformationMatrix(1, 0, 0, 1, r.x, r.y), drawObject(name), popGraphicsState()];
    }
  }
  const mk = widget.getAppearanceCharacteristics();
  const bg = toColor(mk?.getBackgroundColor());
  const bc = toColor(mk?.getBorderColor());
  const bw = widget.getBorderStyle()?.getWidth() ?? 1;
  const ops: PDFOperator[] = [pushGraphicsState()];
  if (bg) ops.push(setFillingColor(bg), rectangle(r.x, r.y, r.width, r.height), fill());
  if (bc && bw > 0) {
    ops.push(setStrokingColor(bc), setLineWidth(bw), rectangle(r.x + bw / 2, r.y + bw / 2, r.width - bw, r.height - bw), stroke());
  }
  ops.push(popGraphicsState());
  return ops.length > 2 ? ops : [];
}

function toColor(c: number[] | undefined): Color | undefined {
  if (!c || c.length === 0) return undefined;
  if (c.length === 1) return grayscale(c[0]!);
  if (c.length === 3) return rgb(c[0]!, c[1]!, c[2]!);
  if (c.length === 4) return cmyk(c[0]!, c[1]!, c[2]!, c[3]!);
  return undefined;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

export function parseColor(hex: string): Color {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return rgb(0, 0, 0);
  let h = m[1]!;
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export function decodeDataUrl(url: string): { data: Uint8Array; format: 'png' | 'jpeg' } {
  const m = /^data:image\/(png|jpeg|jpg);base64,(.*)$/s.exec(url);
  if (!m) throw new ExportError('failed', 'A signature image is not in a supported format.');
  const bin = atob(m[2]!);
  const data = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
  return { data, format: m[1] === 'png' ? 'png' : 'jpeg' };
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
