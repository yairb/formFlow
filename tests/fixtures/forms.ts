import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import fontkit from '@pdf-lib/fontkit';
import { createCanvas } from '@napi-rs/canvas';
import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import type { FieldKind } from '@/model/types';
import { buildRentalApplication } from '@/samples/rentalApplication';
import { TruthRecorder, type TruthField } from '@/samples/truth';
import { toVisualOrder } from '@/text/bidi';
import { DOC_TEXT_FEATURES } from '@/text/metrics';

/**
 * Detection fixtures: generated PDFs with recorded ground truth. Each fixture is
 * built the way real forms are (printed labels plus rules, boxes or typed
 * underscores), and the truth lists every place a person would write — nothing
 * else. Negatives (invoice, letter) have no truth fields at all.
 */

export interface Fixture {
  name: string;
  description: string;
  bytes: Uint8Array;
  truth: TruthField[];
  /** Truth entries that are native AcroForm widgets (scored separately). */
  nativeLabels?: string[];
  /** Pages expected to be reported as scanned. */
  scannedPages?: number[];
}

const fontsDir = fileURLToPath(new URL('../../src/assets/fonts/', import.meta.url));
const INK = rgb(0.12, 0.12, 0.14);
const GREY = rgb(0.4, 0.4, 0.45);
const H = 842; // A4 height
const W = 595;
const Y = (top: number) => H - top;

function txt(p: PDFPage, s: string, x: number, top: number, font: PDFFont, size: number) {
  p.drawText(s, { x, y: Y(top), size, font, color: INK });
}

function rule(p: PDFPage, x1: number, x2: number, top: number, thickness = 0.6) {
  p.drawLine({ start: { x: x1, y: Y(top) }, end: { x: x2, y: Y(top) }, thickness, color: GREY });
}

export async function buildFixtures(): Promise<Fixture[]> {
  return [await rental(), await hebrew(), await underscores(), await acroMixed(), await invoice(), await letter(), await scanned(), await stress()];
}

// ---------------------------------------------------------------------------

async function rental(): Promise<Fixture> {
  const truth = new TruthRecorder();
  const bytes = await buildRentalApplication(truth);
  return { name: 'rental-application', description: 'EN, 2 pages: underlines, boxes, checkboxes, table, signature, office-use block', bytes, truth: truth.fields };
}

// ---------------------------------------------------------------------------

async function hebrew(): Promise<Fixture> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const he = await doc.embedFont(await readFile(fontsDir + 'NotoSansHebrew-Regular.ttf'), { subset: true, features: DOC_TEXT_FEATURES });
  const heBold = await doc.embedFont(await readFile(fontsDir + 'NotoSansHebrew-Bold.ttf'), { subset: true, features: DOC_TEXT_FEATURES });
  const p = doc.addPage([W, H]);
  const t = new TruthRecorder();
  const MR = W - 50;
  const ML = 50;

  // pdf-lib has no bidi: strings are drawn in visual order, as RTL generators do.
  const rtl = (s: string, right: number, top: number, font: PDFFont, size: number) => {
    const v = toVisualOrder(s, 'rtl');
    const w = font.widthOfTextAtSize(v, size);
    p.drawText(v, { x: right - w, y: Y(top), size, font, color: INK });
    return right - w;
  };
  rtl('טופס הצטרפות למועדון', MR, 70, heBold, 18);
  rtl('יש למלא את כל הפרטים בכתב ברור ולהחזיר למזכירות.', MR, 92, he, 9);

  const line = (label: string, right: number, left: number, top: number, kind: FieldKind = 'text') => {
    const lx = rtl(label, right, top, he, 10);
    const end = lx - 5;
    rule(p, left, end, top + 2);
    t.line(kind, label, left, end, top + 2);
  };
  line('שם פרטי', MR, 320, 130);
  line('שם משפחה', 300, ML, 130);
  line('תעודת זהות', MR, 320, 160);
  line('תאריך לידה', 300, ML, 160, 'date');
  line('כתובת', MR, ML, 190);
  line('טלפון נייד', MR, 320, 220);
  line('דוא"ל', 300, ML, 220);

  // Yes / no squares: the square sits to the right of its option text (RTL).
  rtl('האם היית חבר בעבר?', MR, 260, he, 10);
  const yesNo = (opt: string, boxRight: number, top: number) => {
    p.drawRectangle({ x: boxRight - 9, y: Y(top + 1), width: 9, height: 9, borderColor: INK, borderWidth: 0.7 });
    rtl(opt, boxRight - 13, top, he, 10);
    t.add('checkbox', opt, { x: boxRight - 9, y: top + 1 - 9, width: 9, height: 9 });
  };
  yesNo('כן', 420, 260);
  yesNo('לא', 370, 260);

  rtl('הערות', MR, 300, he, 9);
  p.drawRectangle({ x: ML, y: Y(360), width: MR - ML, height: 54, borderColor: GREY, borderWidth: 0.6 });
  t.add('multiline', 'הערות', { x: ML, y: 306, width: MR - ML, height: 54 });

  rule(p, 330, MR, 430, 0.8);
  rtl('חתימה', MR, 442, he, 9);
  t.line('signature', 'חתימה', 330, MR, 430, 30);
  rule(p, ML, 260, 430, 0.8);
  rtl('תאריך', 260, 442, he, 9);
  t.line('date', 'תאריך', ML, 260, 430);

  return { name: 'hebrew-membership', description: 'HE (RTL), 1 page: right-aligned labels, lines, check squares, box, signature', bytes: await doc.save(), truth: t.fields };
}

// ---------------------------------------------------------------------------

async function underscores(): Promise<Fixture> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const t = new TruthRecorder();
  const size = 10;

  /** Draws `parts` on one line; '_n' entries are typed blanks of n underscores. */
  const typed = (p: PDFPage, parts: { s: string; label?: string; kind?: FieldKind }[], x: number, top: number) => {
    let cx = x;
    for (const part of parts) {
      const w = font.widthOfTextAtSize(part.s, size);
      if (part.label) t.add(part.kind ?? 'text', part.label, { x: cx, y: top - 13, width: w, height: 14 });
      cx += w;
    }
    txt(p, parts.map((q) => q.s).join(''), x, top, font, size);
  };
  const u = (n: number) => '_'.repeat(n);

  const p1 = doc.addPage([W, H]);
  txt(p1, 'Volunteer Registration / Registro de voluntarios', 50, 70, bold, 15);
  txt(p1, 'Instructions:', 50, 100, bold, 10);
  txt(p1, 'Complete every line. Use block capitals. Return this sheet to the front desk.', 50, 114, font, 9);
  typed(p1, [{ s: 'Name: ' }, { s: u(40), label: 'Name' }, { s: '   Date: ' }, { s: u(16), label: 'Date', kind: 'date' }], 50, 150);
  typed(p1, [{ s: 'Address: ' }, { s: u(68), label: 'Address' }], 50, 180);
  typed(p1, [{ s: 'Phone: ' }, { s: u(24), label: 'Phone' }, { s: '   Email: ' }, { s: u(34), label: 'Email' }], 50, 210);
  typed(p1, [{ s: 'Nombre del contacto de emergencia: ' }, { s: u(36), label: 'Nombre del contacto de emergencia' }], 50, 240);
  typed(p1, [{ s: 'Teléfono: ' }, { s: u(26), label: 'Teléfono' }, { s: '   Fecha de nacimiento: ' }, { s: u(16), label: 'Fecha de nacimiento', kind: 'date' }], 50, 270);
  txt(p1, 'Availability', 50, 310, bold, 11);
  typed(p1, [{ s: 'Days available: ' }, { s: u(30), label: 'Days available' }], 50, 336);
  // A colon label with open space after it (no rule): weak, low-confidence case.
  txt(p1, 'Allergies or medical notes:', 50, 366, font, size);
  t.add('text', 'Allergies or medical notes', { x: 50 + font.widthOfTextAtSize('Allergies or medical notes:', size) + 4, y: 353, width: 300, height: 14 });
  typed(p1, [{ s: 'Firma: ' }, { s: u(36), label: 'Firma', kind: 'signature' }, { s: '   Fecha: ' }, { s: u(16), label: 'Fecha', kind: 'date' }], 50, 420);

  return { name: 'underscore-volunteer', description: 'EN/ES, 1 page: typed underscore blanks, a colon-space blank, heading-with-colon negative', bytes: await doc.save(), truth: t.fields };
}

// ---------------------------------------------------------------------------

async function acroMixed(): Promise<Fixture> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([W, H]);
  const t = new TruthRecorder();
  const form = doc.getForm();
  txt(p, 'Equipment Loan Agreement', 50, 70, font, 16);

  const native = (label: string, name: string, x: number, top: number, w: number) => {
    txt(p, label, x, top, font, 9);
    const f = form.createTextField(name);
    f.addToPage(p, { x: x + 80, y: Y(top + 4), width: w, height: 16, borderWidth: 0.6 });
    t.add('text', label, { x: x + 80, y: top - 12, width: w, height: 16 });
  };
  native('Borrower', 'borrower', 50, 110, 200);
  native('Department', 'department', 50, 140, 200);
  const cb = form.createCheckBox('insured');
  cb.addToPage(p, { x: 50, y: Y(178), width: 11, height: 11 });
  txt(p, 'Covered by department insurance', 66, 176, font, 9);
  t.add('checkbox', 'Covered by department insurance', { x: 50, y: 167, width: 11, height: 11 });

  // The rest of the form was never made fillable: plain lines.
  const flat = (label: string, x: number, top: number, x2: number, kind: FieldKind = 'text') => {
    txt(p, label, x, top, font, 9);
    const lx = x + font.widthOfTextAtSize(label, 9) + 5;
    rule(p, lx, x2, top + 1.5);
    t.line(kind, label, lx, x2, top + 1.5);
  };
  flat('Serial number', 50, 220, 300);
  flat('Return by', 320, 220, 545, 'date');
  flat('Approved by', 50, 250, 545);
  return {
    name: 'acroform-mixed',
    description: 'EN, 1 page: 3 native AcroForm widgets plus 3 flat line fields',
    bytes: await doc.save(),
    truth: t.fields,
    nativeLabels: ['Borrower', 'Department', 'Covered by department insurance'],
  };
}

// ---------------------------------------------------------------------------

async function invoice(): Promise<Fixture> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const p = doc.addPage([W, H]);
  txt(p, 'INVOICE', 50, 70, bold, 20);
  txt(p, 'Invoice no: 2026-0417', 400, 66, font, 9);
  txt(p, 'Date: 12 March 2026', 400, 80, font, 9);
  rule(p, 50, 545, 96, 1);
  txt(p, 'Bill to:', 50, 120, bold, 9);
  txt(p, 'Northwind Analytics Ltd.', 50, 134, font, 9);
  txt(p, '22 Quay Street, Dublin D02 X285', 50, 146, font, 9);
  const rows = [
    ['Description', 'Qty', 'Unit price', 'Amount'],
    ['Data pipeline audit', '1', '2,400.00', '2,400.00'],
    ['Dashboard redesign (hours)', '18', '95.00', '1,710.00'],
    ['Hosting, Q1', '3', '120.00', '360.00'],
  ];
  const xs = [50, 300, 380, 470, 545];
  rows.forEach((r, i) => {
    const top = 180 + i * 20;
    r.forEach((c, k) => txt(p, c, xs[k]! + 4, top + 14, i === 0 ? bold : font, 9));
    rule(p, 50, 545, top);
  });
  rule(p, 50, 545, 260);
  for (const x of xs) p.drawLine({ start: { x, y: Y(180) }, end: { x, y: Y(260) }, thickness: 0.6, color: GREY });
  txt(p, 'Total:', 400, 284, bold, 10);
  txt(p, 'EUR 4,470.00', 470, 284, bold, 10);
  txt(p, 'Payment terms: 30 days. Bank: IE29 AIBK 9311 5212 3456 78.', 50, 330, font, 8);
  return { name: 'invoice-negative', description: 'Negative: completed invoice table, separators, colon labels with values', bytes: await doc.save(), truth: [] };
}

async function letter(): Promise<Fixture> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const p = doc.addPage([W, H]);
  txt(p, 'Ostrander & Vale LLP', 50, 70, font, 16);
  rule(p, 50, 545, 84, 0.8);
  const body = [
    '4 April 2026',
    '',
    'Dear Ms. Lindqvist,',
    '',
    'Re: Lease renewal for 14 Marlowe Court',
    '',
    'Thank you for your letter of 28 March. Our client is pleased to offer a renewal of the',
    'lease on the terms set out in the enclosed schedule. Please note the following:',
    'the monthly rent will remain unchanged for the first six months.',
    '',
    'Yours sincerely,',
  ];
  body.forEach((l, i) => txt(p, l, 50, 120 + i * 15, font, 11));
  txt(p, 'Martin Ostrander', 50, 330, font, 11);
  txt(p, 'Partner', 50, 344, font, 10);
  rule(p, 50, 545, 780, 0.5);
  txt(p, 'Ostrander & Vale LLP · 9 Harcourt Place, Leeds LS1 4HD', 50, 794, font, 8);
  return { name: 'letter-negative', description: 'Negative: business letter with rules, a colon line and a sign-off', bytes: await doc.save(), truth: [] };
}

async function scanned(): Promise<Fixture> {
  const doc = await PDFDocument.create();
  const canvas = createCanvas(600, 840);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f4f2ec';
  ctx.fillRect(0, 0, 600, 840);
  ctx.fillStyle = '#333';
  ctx.font = '20px sans-serif';
  ctx.fillText('Scanned form (raster image)', 60, 80);
  ctx.fillRect(60, 160, 400, 1);
  const png = await doc.embedPng(canvas.toBuffer('image/png'));
  const p = doc.addPage([W, H]);
  p.drawImage(png, { x: 0, y: 0, width: W, height: H });
  return { name: 'scanned-image', description: 'Image-only page: must be reported as scanned (no OCR)', bytes: await doc.save(), truth: [], scannedPages: [0] };
}

// ---------------------------------------------------------------------------

/**
 * Layouts written as a held-out set before the detector handled them: dot leaders,
 * comb boxes, labels set far from their lines, a dashed rule, a page rotated 90°.
 * The untuned baseline is recorded in docs/detection.md; the detector was improved
 * against it afterwards, so it is no longer held-out.
 */
async function stress(): Promise<Fixture> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const t = new TruthRecorder();
  const p = doc.addPage([W, H]);
  txt(p, 'Club Membership Renewal', 50, 70, font, 16);

  // Dot leaders typed as text.
  const dots = (label: string, top: number) => {
    const s = `${label} ${'.'.repeat(60)}`;
    txt(p, s, 50, top, font, 10);
    const x = 50 + font.widthOfTextAtSize(`${label} `, 10);
    t.add('text', label, { x, y: top - 12, width: font.widthOfTextAtSize('.'.repeat(60), 10), height: 14 });
  };
  dots('Member name', 110);
  dots('Membership number', 135);

  // Comb boxes: one character per cell, one field.
  txt(p, 'Postcode', 50, 172, font, 10);
  for (let i = 0; i < 7; i++) p.drawRectangle({ x: 130 + i * 14, y: Y(176), width: 14, height: 14, borderColor: GREY, borderWidth: 0.6 });
  t.add('text', 'Postcode', { x: 130, y: 162, width: 98, height: 14 });

  // Tabular layout: labels in a left column, lines start far to the right.
  const far = (label: string, top: number, kind: FieldKind = 'text') => {
    txt(p, label, 50, top, font, 10);
    rule(p, 200, 545, top + 2);
    t.line(kind, label, 200, 545, top + 2);
  };
  far('Occupation', 210);
  far('Renewal date', 236, 'date');

  // Dashed rule with the label underneath.
  p.drawLine({ start: { x: 50, y: Y(290) }, end: { x: 300, y: Y(290) }, thickness: 0.6, color: GREY, dashArray: [2, 2] });
  txt(p, 'Print name', 50, 301, font, 8);
  t.line('text', 'Print name', 50, 300, 290);

  // A landscape page stored rotated: content drawn in the rotated frame.
  const r = doc.addPage([W, H]);
  r.setRotation(degrees(90));
  t.page = 1;
  // Display space is H wide × W tall; user (x, y) maps to display (y, x).
  r.drawText('Signature', { x: 100, y: 100, size: 10, font, color: INK, rotate: degrees(90) });
  r.drawLine({ start: { x: 98, y: 160 }, end: { x: 98, y: 400 }, thickness: 0.6, color: GREY });
  t.line('signature', 'Signature', 160, 400, 98, 30);

  return { name: 'stress-layouts', description: 'Formerly held-out: dot leaders, comb boxes, distant labels, dashed rule, rotated page', bytes: await doc.save(), truth: t.fields };
}
