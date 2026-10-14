import { createHash } from 'node:crypto';

/**
 * Builds a small encrypted PDF (Standard security handler, RC4 40-bit, R2) without
 * external tools, so the password prompt and the encrypted-export fallback can be
 * tested. The page shows a "Name:" label with a fill line next to it.
 *
 * `userPassword` empty → opens without a password (owner-restricted only), the
 * common case for "secured" government and bank forms.
 */

const PAD = Uint8Array.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f,
  0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i]! + key[i % key.length]!) & 0xff;
    [s[i], s[j]] = [s[j]!, s[i]!];
  }
  const out = new Uint8Array(data.length);
  let i = 0;
  j = 0;
  for (let k = 0; k < data.length; k++) {
    i = (i + 1) & 0xff;
    j = (j + s[i]!) & 0xff;
    [s[i], s[j]] = [s[j]!, s[i]!];
    out[k] = data[k]! ^ s[(s[i]! + s[j]!) & 0xff]!;
  }
  return out;
}

const md5 = (...parts: Uint8Array[]) => {
  const h = createHash('md5');
  for (const p of parts) h.update(p);
  return new Uint8Array(h.digest());
};

function padPassword(pw: string): Uint8Array {
  const bytes = new TextEncoder().encode(pw).slice(0, 32);
  const out = new Uint8Array(32);
  out.set(bytes);
  out.set(PAD.slice(0, 32 - bytes.length), bytes.length);
  return out;
}

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

export function makeEncryptedPdf(opts: { userPassword?: string; ownerPassword?: string } = {}): Uint8Array {
  const user = opts.userPassword ?? '';
  const owner = opts.ownerPassword ?? 'owner-secret';
  const P = -44;
  const id = md5(new TextEncoder().encode(`formflow-fixture-${user}-${owner}`));

  const O = rc4(md5(padPassword(owner)).slice(0, 5), padPassword(user));
  const pBytes = new Uint8Array(4);
  new DataView(pBytes.buffer).setInt32(0, P, true);
  const key = md5(padPassword(user), O, pBytes, id).slice(0, 5);
  const U = rc4(key, PAD);
  const objectKey = (num: number) => md5(key, Uint8Array.from([num & 0xff, (num >> 8) & 0xff, (num >> 16) & 0xff, 0, 0])).slice(0, 10);

  const content = new TextEncoder().encode(
    'BT /F1 14 Tf 72 700 Td (Name:) Tj ET\n0.2 0.2 0.2 RG 0.75 w 125 697 m 400 697 l S\nBT /F1 11 Tf 72 740 Td (Secured form) Tj ET\n',
  );
  const encContent = rc4(objectKey(4), content);

  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (b: Uint8Array | string) => {
    const bytes = typeof b === 'string' ? enc.encode(b) : b;
    chunks.push(bytes);
    length += bytes.length;
  };
  const obj = (num: number, body: string) => {
    offsets[num] = length;
    push(`${num} 0 obj\n${body}\nendobj\n`);
  };

  push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>');
  offsets[4] = length;
  push(`4 0 obj\n<< /Length ${encContent.length} >>\nstream\n`);
  push(encContent);
  push('\nendstream\nendobj\n');
  obj(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  obj(6, `<< /Filter /Standard /V 1 /R 2 /O <${hex(O)}> /U <${hex(U)}> /P ${P} >>`);

  const xref = length;
  push(`xref\n0 7\n0000000000 65535 f \n`);
  for (let n = 1; n <= 6; n++) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size 7 /Root 1 0 R /Encrypt 6 0 R /ID [<${hex(id)}> <${hex(id)}>] >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
