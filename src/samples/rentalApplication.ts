import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import type { FieldKind } from '@/model/types';
import type { TruthRecorder } from './truth';

/**
 * Generates a realistic two-page, flat (non-AcroForm) rental application: printed
 * labels, underlines, boxes, checkbox squares and a signature line, the way most
 * scanned or "print and fill" forms look. Used by the "Try a sample form" button
 * and as a detection fixture. The company and property are fictional.
 */
export async function buildRentalApplication(truth?: TruthRecorder): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('Residential Rental Application');
  doc.setProducer('FormFlow sample generator');
  doc.setCreationDate(new Date('2026-01-05T09:00:00Z'));
  doc.setModificationDate(new Date('2026-01-05T09:00:00Z'));
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const f: Fonts = { regular, bold, truth };

  page1(doc.addPage([612, 792]), f);
  if (truth) truth.page = 1;
  page2(doc.addPage([612, 792]), f);
  return doc.save();
}

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  truth?: TruthRecorder;
}

const INK = rgb(0.13, 0.14, 0.17);
const MUTED = rgb(0.38, 0.4, 0.45);
const RULE = rgb(0.55, 0.57, 0.62);
const TINT = rgb(0.94, 0.95, 0.97);
const ML = 54;
const MR = 612 - 54;

/** pdf-lib uses a bottom-left origin; these helpers take top-down y for readability. */
const Y = (top: number) => 792 - top;

/** Ground-truth kinds, stated explicitly (not derived from the detection lexicon). */
const DATE_LABELS = new Set(['Desired move-in date', 'Date of birth', 'Start date']);
const truthKind = (label: string): FieldKind => (DATE_LABELS.has(label) ? 'date' : 'text');

function text(p: PDFPage, s: string, x: number, top: number, font: PDFFont, size: number, color = INK) {
  p.drawText(s, { x, y: Y(top), size, font, color });
}

/** A label followed by an underline that runs to `x2`. Returns nothing; layout is explicit. */
function lineField(p: PDFPage, f: Fonts, label: string, x: number, top: number, x2: number) {
  text(p, label, x, top, f.regular, 8.5, MUTED);
  const lx = x + f.regular.widthOfTextAtSize(label, 8.5) + 5;
  p.drawLine({ start: { x: lx, y: Y(top + 1.5) }, end: { x: x2, y: Y(top + 1.5) }, thickness: 0.6, color: RULE });
  f.truth?.line(truthKind(label), label, lx, x2, top + 1.5);
}

/** A label above an empty box (common for "block" style forms). */
function boxField(p: PDFPage, f: Fonts, label: string, x: number, top: number, w: number, h = 20) {
  text(p, label, x, top, f.regular, 7.5, MUTED);
  p.drawRectangle({ x, y: Y(top + 4 + h), width: w, height: h, borderColor: RULE, borderWidth: 0.6 });
  f.truth?.add(truthKind(label), label, { x, y: top + 4, width: w, height: h });
}

function checkbox(p: PDFPage, f: Fonts, label: string, x: number, top: number) {
  p.drawRectangle({ x, y: Y(top + 1.5), width: 9, height: 9, borderColor: INK, borderWidth: 0.7 });
  text(p, label, x + 13, top, f.regular, 9);
  f.truth?.add('checkbox', label, { x, y: top + 1.5 - 9, width: 9, height: 9 });
}

function sectionHeading(p: PDFPage, f: Fonts, n: number, title: string, top: number) {
  p.drawRectangle({ x: ML, y: Y(top + 6), width: MR - ML, height: 18, color: TINT });
  text(p, `${n}.`, ML + 7, top, f.bold, 9.5, INK);
  text(p, title.toUpperCase(), ML + 22, top, f.bold, 9.5, INK);
}

function paragraph(p: PDFPage, f: PDFFont, s: string, x: number, top: number, width: number, size: number, leading: number): number {
  const words = s.split(' ');
  let line = '';
  let y = top;
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (f.widthOfTextAtSize(next, size) > width && line) {
      text(p, line, x, y, f, size, MUTED);
      line = w;
      y += leading;
    } else line = next;
  }
  if (line) text(p, line, x, y, f, size, MUTED);
  return y + leading;
}

function header(p: PDFPage, f: Fonts, pageNo: number) {
  // Fictional letterhead mark.
  p.drawRectangle({ x: ML, y: Y(70), width: 26, height: 26, color: rgb(0.18, 0.33, 0.29) });
  p.drawLine({ start: { x: ML + 6, y: Y(52) }, end: { x: ML + 13, y: Y(60) }, thickness: 1.6, color: rgb(1, 1, 1) });
  p.drawLine({ start: { x: ML + 13, y: Y(60) }, end: { x: ML + 20, y: Y(52) }, thickness: 1.6, color: rgb(1, 1, 1) });
  text(p, 'Harbor & Pine Property Management', ML + 34, 56, f.bold, 11);
  text(p, '1840 Larkspur Avenue, Suite 210  ·  Portland, OR 97209  ·  (503) 555-0148', ML + 34, 68, f.regular, 8, MUTED);
  text(p, `Page ${pageNo} of 2`, MR - f.regular.widthOfTextAtSize(`Page ${pageNo} of 2`, 8), 56, f.regular, 8, MUTED);
  p.drawLine({ start: { x: ML, y: Y(82) }, end: { x: MR, y: Y(82) }, thickness: 1, color: INK });
}

function footer(p: PDFPage, f: Fonts) {
  text(p, 'Form HP-RA-07 (rev. 01/2026)', ML, 760, f.regular, 7, MUTED);
  const s = 'Harbor & Pine is an equal housing opportunity provider.';
  text(p, s, MR - f.regular.widthOfTextAtSize(s, 7), 760, f.regular, 7, MUTED);
}

function page1(p: PDFPage, f: Fonts) {
  header(p, f, 1);
  text(p, 'Residential Rental Application', ML, 112, f.bold, 18);
  paragraph(
    p,
    f.regular,
    'Each adult (18+) who will live in the unit must complete a separate application. Please print clearly. Incomplete applications cannot be processed.',
    ML,
    128,
    MR - ML,
    8.5,
    11,
  );

  lineField(p, f, 'Property address applied for', ML, 162, 330);
  lineField(p, f, 'Unit', 340, 162, 390);
  lineField(p, f, 'Desired move-in date', 400, 162, MR);

  sectionHeading(p, f, 1, 'Applicant information', 192);
  lineField(p, f, 'Full legal name', ML, 222, 400);
  lineField(p, f, 'Date of birth', 410, 222, MR);
  lineField(p, f, 'Phone', ML, 248, 230);
  lineField(p, f, 'Email', 240, 248, MR);
  lineField(p, f, 'Driver’s license / ID no.', ML, 274, 330);
  lineField(p, f, 'State', 340, 274, 400);
  lineField(p, f, 'Last 4 of SSN', 410, 274, MR);

  sectionHeading(p, f, 2, 'Residence history', 306);
  lineField(p, f, 'Current address', ML, 336, MR);
  lineField(p, f, 'City', ML, 362, 260);
  lineField(p, f, 'State', 270, 362, 350);
  lineField(p, f, 'ZIP', 360, 362, 440);
  lineField(p, f, 'Monthly rent', 450, 362, MR);
  lineField(p, f, 'Landlord / manager name', ML, 388, 360);
  lineField(p, f, 'Landlord phone', 370, 388, MR);
  text(p, 'Reason for moving', ML, 414, f.regular, 8.5, MUTED);
  p.drawRectangle({ x: ML, y: Y(458), width: MR - ML, height: 38, borderColor: RULE, borderWidth: 0.6 });
  f.truth?.add('multiline', 'Reason for moving', { x: ML, y: 420, width: MR - ML, height: 38 });

  sectionHeading(p, f, 3, 'Employment and income', 484);
  boxField(p, f, 'Current employer', ML, 512, 250);
  boxField(p, f, 'Position / title', ML + 260, 512, 140);
  boxField(p, f, 'Start date', ML + 410, 512, MR - ML - 410);
  boxField(p, f, 'Supervisor name', ML, 548, 250);
  boxField(p, f, 'Work phone', ML + 260, 548, 140);
  boxField(p, f, 'Gross monthly income ($)', ML + 410, 548, MR - ML - 410);

  sectionHeading(p, f, 4, 'Household', 590);
  text(p, 'Will any pets live in the unit?', ML, 618, f.regular, 9);
  checkbox(p, f, 'Yes', 230, 618);
  checkbox(p, f, 'No', 280, 618);
  lineField(p, f, 'If yes, type and weight', 330, 618, MR);
  text(p, 'Does anyone in the household smoke?', ML, 640, f.regular, 9);
  checkbox(p, f, 'Yes', 230, 640);
  checkbox(p, f, 'No', 280, 640);
  text(p, 'Have you ever been evicted?', ML, 662, f.regular, 9);
  checkbox(p, f, 'Yes', 230, 662);
  checkbox(p, f, 'No', 280, 662);
  lineField(p, f, 'Number of occupants', 330, 662, MR);

  footer(p, f);
}

function page2(p: PDFPage, f: Fonts) {
  header(p, f, 2);

  sectionHeading(p, f, 5, 'Other occupants', 108);
  const cols = [
    { label: 'Name', x: ML, w: 230 },
    { label: 'Relationship', x: ML + 230, w: 130 },
    { label: 'Date of birth', x: ML + 360, w: MR - ML - 360 },
  ];
  const tableTop = 124;
  const rowH = 22;
  p.drawRectangle({ x: ML, y: Y(tableTop + 16), width: MR - ML, height: 16, color: TINT });
  for (const c of cols) text(p, c.label, c.x + 5, tableTop + 11, f.bold, 8);
  for (let r = 0; r <= 4; r++) {
    const y = tableTop + 16 + r * rowH;
    p.drawLine({ start: { x: ML, y: Y(y) }, end: { x: MR, y: Y(y) }, thickness: 0.6, color: RULE });
  }
  for (const x of [ML, ML + 230, ML + 360, MR]) {
    p.drawLine({ start: { x, y: Y(tableTop) }, end: { x, y: Y(tableTop + 16 + 4 * rowH) }, thickness: 0.6, color: RULE });
  }
  p.drawLine({ start: { x: ML, y: Y(tableTop) }, end: { x: MR, y: Y(tableTop) }, thickness: 0.6, color: RULE });
  for (let r = 0; r < 4; r++) {
    for (const c of cols) f.truth?.add(truthKind(c.label), `${c.label} (row ${r + 1})`, { x: c.x, y: tableTop + 16 + r * rowH, width: c.w, height: rowH });
  }

  sectionHeading(p, f, 6, 'Vehicles', 248);
  lineField(p, f, 'Make / model', ML, 278, 300);
  lineField(p, f, 'Year', 310, 278, 380);
  lineField(p, f, 'License plate', 390, 278, MR);

  sectionHeading(p, f, 7, 'Emergency contact', 310);
  lineField(p, f, 'Name', ML, 340, 330);
  lineField(p, f, 'Relationship', 340, 340, MR);
  lineField(p, f, 'Phone', ML, 366, 260);
  lineField(p, f, 'Email', 270, 366, MR);

  sectionHeading(p, f, 8, 'Authorization and signature', 398);
  const after = paragraph(
    p,
    f.regular,
    'I certify that the information in this application is true and complete. I authorize Harbor & Pine Property Management to verify it, including by contacting employers and previous landlords and by obtaining a consumer credit report. I understand that false or incomplete information may be grounds for rejecting this application or terminating a lease. A non-refundable application fee of $45.00 is due with this application.',
    ML,
    428,
    MR - ML,
    8.5,
    11.5,
  );
  checkbox(p, f, 'I have read and agree to the statement above.', ML, after + 8);

  const sigTop = after + 62;
  p.drawLine({ start: { x: ML, y: Y(sigTop) }, end: { x: 360, y: Y(sigTop) }, thickness: 0.8, color: INK });
  p.drawLine({ start: { x: 380, y: Y(sigTop) }, end: { x: MR, y: Y(sigTop) }, thickness: 0.8, color: INK });
  text(p, 'Applicant signature', ML, sigTop + 11, f.regular, 8, MUTED);
  text(p, 'Date', 380, sigTop + 11, f.regular, 8, MUTED);
  f.truth?.line('signature', 'Applicant signature', ML, 360, sigTop, 30);
  f.truth?.line('date', 'Date', 380, MR, sigTop);

  // Office use block — realistic, and a useful negative case for detection.
  const boxTop = sigTop + 46;
  p.drawRectangle({ x: ML, y: Y(boxTop + 64), width: MR - ML, height: 64, borderColor: RULE, borderWidth: 0.6, borderDashArray: [3, 2] });
  text(p, 'FOR OFFICE USE ONLY', ML + 8, boxTop + 14, f.bold, 7.5, MUTED);
  text(p, 'Received by: ________________     Fee paid: ______     Approved / Denied     Date: ___________', ML + 8, boxTop + 36, f.regular, 8, MUTED);

  footer(p, f);
}
