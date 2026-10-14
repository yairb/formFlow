import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import { importNativeValues, readNativeFields } from '@/detect/acroform';
import { exportPdf } from '@/export/exportPdf';
import { setFieldChecked, setFieldText, setFields, type FillDefaults } from '@/model/fields';
import { dirtyNativeFieldNames } from '@/model/native';
import { EMPTY_MODEL, type DocModel, type FormField } from '@/model/types';
import type { FontLibrary } from '@/text/fonts';
import { loadTestFonts } from '../helpers/fonts';
import { blankManagedNativeFields, PAGE_ANNOTATION_MODE } from '@/pdf/render';
import { extractText, inkBounds, open, renderPage } from '../helpers/pdf';

let fonts: FontLibrary;
beforeAll(async () => {
  fonts = await loadTestFonts();
});

const DEFAULTS: FillDefaults = { fontFamily: 'sans', color: '#111827', dateFormat: 'YYYY-MM-DD', maxFontSize: 12 };

async function makeForm(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const form = doc.getForm();
  page.drawText('Name', { x: 50, y: 705, size: 11, font: helv });
  const name = form.createTextField('applicant.name');
  name.setText('Alice Smith');
  name.addToPage(page, { x: 120, y: 700, width: 200, height: 20, borderColor: rgb(0, 0, 0), borderWidth: 1 });
  page.drawText('City', { x: 50, y: 665, size: 11, font: helv });
  const city = form.createTextField('applicant.city');
  city.addToPage(page, { x: 120, y: 660, width: 200, height: 20, borderColor: rgb(0, 0, 0), borderWidth: 1 });
  const agree = form.createCheckBox('agree');
  agree.addToPage(page, { x: 120, y: 620, width: 14, height: 14 });
  const plan = form.createRadioGroup('plan');
  plan.addOptionToPage('basic', page, { x: 120, y: 580, width: 14, height: 14 });
  plan.addOptionToPage('pro', page, { x: 180, y: 580, width: 14, height: 14 });
  plan.select('basic');
  const locked = form.createTextField('locked');
  locked.setText('Fixed');
  locked.enableReadOnly();
  locked.addToPage(page, { x: 120, y: 540, width: 200, height: 20 });
  return doc.save();
}

async function loadModel(bytes: Uint8Array) {
  const opened = await open(bytes);
  const page = await opened.doc.getPage(1);
  const fields = await readNativeFields(page, opened.pages[0]!);
  const model = importNativeValues(setFields(EMPTY_MODEL, fields), DEFAULTS);
  return { opened, fields, model };
}

const byName = (fields: FormField[], name: string, widget = 0) =>
  fields.filter((f) => f.native?.name === name)[widget]!;

describe('native AcroForm fields', () => {
  it('reads widgets with kinds, labels, values and display rects', async () => {
    const { fields, opened } = await loadModel(await makeForm());
    expect(fields.map((f) => [f.native!.name, f.kind])).toEqual([
      ['applicant.name', 'text'],
      ['applicant.city', 'text'],
      ['agree', 'checkbox'],
      ['plan', 'radio'],
      ['plan', 'radio'],
      ['locked', 'text'],
    ]);
    const name = byName(fields, 'applicant.name');
    expect(name.label).toBe('Name');
    expect(name.native!.originalValue).toBe('Alice Smith');
    // pdf-lib grows the widget /Rect by half the border width: [119.5 699.5 320.5 720.5].
    // Flipped into display space: y = 792 - 720.5.
    expect(name.rect).toEqual({ x: 119.5, y: 71.5, width: 201, height: 21 });
    expect(byName(fields, 'locked').native!.readOnly).toBe(true);
    // pdf-lib names radio on-states by option index ("0", "1") and lists labels in /Opt.
    expect(byName(fields, 'plan', 0).native).toMatchObject({ originalValue: '0', exportValue: '0' });
    expect(byName(fields, 'plan', 1).native).toMatchObject({ originalValue: '0', exportValue: '1' });
    await opened.doc.destroy();
  });

  it('imports existing values, and an unchanged form exports without touching fields', async () => {
    const source = await makeForm();
    const { fields, model, opened } = await loadModel(source);
    const nameField = byName(fields, 'applicant.name');
    expect(Object.values(model.annotations).some((a) => a.type === 'text' && a.text === 'Alice Smith' && a.fieldId === nameField.id)).toBe(true);
    expect(dirtyNativeFieldNames(model).size).toBe(0);
    const { bytes } = await exportPdf({ bytes: source, pages: opened.pages, model, fonts });
    const out = await PDFDocument.load(bytes);
    expect(out.getForm().getFields().map((f) => f.getName()).sort()).toEqual(['agree', 'applicant.city', 'applicant.name', 'locked', 'plan']);
    expect(out.getForm().getTextField('applicant.name').getText()).toBe('Alice Smith');
  });

  it('replaces only changed fields with flattened, Unicode-capable content', async () => {
    const source = await makeForm();
    const loaded = await loadModel(source);
    const { fields, opened } = loaded;
    let model: DocModel = loaded.model;
    model = setFieldText(model, byName(fields, 'applicant.city'), 'Zürich · תל אביב', DEFAULTS);
    model = setFieldChecked(model, byName(fields, 'agree'), true, '#111827');
    model = setFieldChecked(model, byName(fields, 'plan', 1), true, '#111827');
    expect([...dirtyNativeFieldNames(model)].sort()).toEqual(['agree', 'applicant.city', 'plan']);

    const { bytes, warnings } = await exportPdf({ bytes: source, pages: opened.pages, model, fonts });
    expect(warnings).toEqual([]);
    const out = await PDFDocument.load(bytes);
    const remaining = out.getForm().getFields().map((f) => f.getName()).sort();
    expect(remaining).toEqual(['applicant.name', 'locked']);
    expect(out.getPage(0).node.Annots()?.size()).toBe(2);

    const reopened = await open(bytes);
    const page = await reopened.doc.getPage(1);
    const text = (await extractText(page)).map((i) => i.str).join(' ');
    expect(text).toContain('Zürich');
    expect(text).toContain('תל');
    expect(text).toContain('אביב');
    // Still-interactive fields are reported by pdf.js as widgets.
    const widgets = (await page.getAnnotations()).filter((a: { subtype?: string }) => a.subtype === 'Widget');
    expect(widgets.map((w: { fieldName?: string }) => w.fieldName).sort()).toEqual(['applicant.name', 'locked']);
  });
});

describe('on-screen rendering of native fields', () => {
  it('blanks managed widget values but keeps borders and read-only values', async () => {
    const { fields, opened } = await loadModel(await makeForm());
    const page = await opened.doc.getPage(1);
    const dark = (r: number, g: number, b: number) => r < 120 && g < 120 && b < 120;
    const name = byName(fields, 'applicant.name');
    const locked = byName(fields, 'locked');
    const radio = byName(fields, 'plan', 0);
    const inner = (f: FormField) => ({ x: f.rect.x + 3, y: f.rect.y + 3, width: f.rect.width - 6, height: f.rect.height - 6 });

    const before = await renderPage(page, 2, PAGE_ANNOTATION_MODE);
    expect(inkBounds(before, dark, inner(name))).not.toBeNull();
    expect(inkBounds(before, dark, inner(radio))).not.toBeNull();

    blankManagedNativeFields(opened.doc, fields);
    const after = await renderPage(page, 2, PAGE_ANNOTATION_MODE);
    expect(inkBounds(after, dark, inner(name))).toBeNull();
    expect(inkBounds(after, dark, inner(radio))).toBeNull();
    // Border of the text field is still drawn.
    expect(inkBounds(after, dark, { ...name.rect, height: 2 })).not.toBeNull();
    // Read-only fields are not managed by FormFlow and keep their value.
    expect(inkBounds(after, dark, inner(locked))).not.toBeNull();
    await opened.doc.destroy();
  });
});
