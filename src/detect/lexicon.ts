import type { FieldKind } from '@/model/types';

/**
 * Multilingual label vocabulary (English, Hebrew, Spanish, French, German, Arabic).
 * Terms are matched case-insensitively against normalized label text; Latin terms
 * match on word boundaries, Hebrew/Arabic terms as substrings (prefixes such as
 * ה/ו/ב attach to words). Kept deliberately small and specific: a term here should
 * almost always indicate a fill-in field when it appears as a short label.
 */

interface TermSet {
  latin: string[];
  rtl: string[];
}

const DATE: TermSet = {
  latin: ['date', 'dob', 'd.o.b', 'birth date', 'date of birth', 'birthdate', 'fecha', 'datum', 'geburtsdatum', 'date de naissance', 'move-in date', 'start date', 'end date', 'expiry', 'expiration'],
  rtl: ['תאריך', 'ת. לידה', 'תאריך לידה', 'تاريخ'],
};

const SIGNATURE: TermSet = {
  latin: ['signature', 'sign here', 'signed', 'signer', 'firma', 'unterschrift', 'signature du', "applicant's signature", 'autograph'],
  rtl: ['חתימה', 'חתימת', 'توقيع'],
};

const MULTILINE: TermSet = {
  latin: ['comments', 'comment', 'remarks', 'notes', 'reason', 'explain', 'explanation', 'description', 'describe', 'additional information', 'details', 'comentarios', 'motivo', 'observaciones', 'commentaires', 'remarques', 'bemerkungen', 'anmerkungen'],
  rtl: ['הערות', 'סיבה', 'פירוט', 'תיאור', 'ملاحظات'],
};

const GENERAL: TermSet = {
  latin: [
    'name', 'first name', 'last name', 'surname', 'full name', 'address', 'street', 'city', 'state', 'zip', 'postal', 'postcode', 'country',
    'phone', 'telephone', 'mobile', 'cell', 'fax', 'email', 'e-mail', 'employer', 'occupation', 'position', 'title', 'company', 'department',
    'id', 'id no', 'license', 'passport', 'ssn', 'number', 'no.', 'amount', 'income', 'salary', 'rent', 'total', 'age', 'gender', 'nationality',
    'relationship', 'contact', 'manager', 'supervisor', 'landlord', 'make', 'model', 'year', 'plate', 'account', 'reference', 'apt', 'unit', 'suite',
    'nombre', 'apellido', 'dirección', 'direccion', 'ciudad', 'teléfono', 'telefono', 'correo', 'código postal', 'nom', 'prénom', 'prenom', 'adresse',
    'ville', 'téléphone', 'courriel', 'vorname', 'nachname', 'straße', 'strasse', 'stadt', 'telefon', 'plz', 'ort',
  ],
  rtl: ['שם', 'כתובת', 'טלפון', 'נייד', 'דוא"ל', 'דואל', 'מייל', 'מספר', 'עיר', 'רחוב', 'מיקוד', 'ת.ז', 'תעודת זהות', 'מעסיק', 'תפקיד', 'כתובת', 'סכום', 'גיל', 'اسم', 'عنوان', 'هاتف', 'مدينة', 'رقم'],
};

const OFFICE_USE: TermSet = {
  latin: ['office use', 'official use', 'for office', 'internal use', 'staff use', 'do not write', 'uso oficial', 'uso exclusivo', 'usage interne', 'réservé', 'nur für', 'amtliche'],
  rtl: ['לשימוש המשרד', 'לשימוש פנימי', 'לשימוש משרדי', 'לא למילוי', 'للاستخدام الرسمي'],
};

const CHOICE: TermSet = {
  latin: ['yes', 'no', 'n/a', 'sí', 'si', 'oui', 'non', 'ja', 'nein', 'male', 'female', 'other'],
  rtl: ['כן', 'לא', 'نعم', 'لا'],
};

function normalize(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[֑-ׇ]/g, '') // Hebrew niqqud / cantillation
    .replace(/[’'`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const latinCache = new Map<TermSet, RegExp>();

function matches(set: TermSet, text: string): boolean {
  const t = normalize(text);
  if (!t) return false;
  for (const r of set.rtl) if (t.includes(r)) return true;
  let re = latinCache.get(set);
  if (!re) {
    const alts = set.latin.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length);
    re = new RegExp(`(^|[^\\p{L}\\p{N}])(${alts.join('|')})(?=$|[^\\p{L}\\p{N}])`, 'u');
    latinCache.set(set, re);
  }
  return re.test(t);
}

export const isDateLabel = (s: string) => matches(DATE, s);
export const isSignatureLabel = (s: string) => matches(SIGNATURE, s);
export const isMultilineLabel = (s: string) => matches(MULTILINE, s);
export const isKnownLabel = (s: string) => matches(GENERAL, s) || isDateLabel(s) || isSignatureLabel(s) || isMultilineLabel(s);
export const isOfficeUseText = (s: string) => matches(OFFICE_USE, s);
export const isChoiceWord = (s: string) => matches(CHOICE, s) && normalize(s).split(' ').length <= 2;

/** Kind suggested by a label for a text-entry area (line or box). */
export function kindForLabel(label: string | null, fallback: FieldKind = 'text'): FieldKind {
  if (!label) return fallback;
  if (isSignatureLabel(label)) return 'signature';
  if (isDateLabel(label)) return 'date';
  if (isMultilineLabel(label)) return 'multiline';
  return fallback;
}

/** Cleans a label for display: trims punctuation, colons, asterisks and underscores. */
export function cleanLabel(s: string): string {
  return s
    .replace(/_{2,}/g, ' ')
    .replace(/[\s:：*־\-–—.]+$/u, '')
    .replace(/^[\s:：*\-–—.]+/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Text that reads like a label: short, ends with a colon, or uses label vocabulary. */
export function labelStrength(s: string): number {
  const t = s.trim();
  if (!t) return 0;
  const words = t.split(/\s+/).length;
  if (words > 9 || t.length > 70) return 0;
  let score = 0.3;
  if (/[:：]\s*$/.test(t) || /^\s*[:：]/.test(t)) score += 0.35;
  if (isKnownLabel(t)) score += 0.3;
  if (/[.!?]$/.test(t) && !/[:：]$/.test(t) && words > 4) score -= 0.25; // sentence, not a label
  if (/^\d+[.)]?$/.test(t)) score -= 0.25; // bare numbering
  return Math.max(0, Math.min(1, score));
}
