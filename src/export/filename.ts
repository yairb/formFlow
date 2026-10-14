// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const INVALID = /[<>:"/\\|?*\u0000-\u001f]/g;
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/** Default export name: "lease.pdf" → "lease-filled.pdf". Never equals the source name. */
export function exportFileName(sourceName: string | null | undefined): string {
  const base = (sourceName ?? '').split(/[\\/]/).pop() ?? '';
  let stem = base.replace(/\.pdf$/i, '').replace(INVALID, '_').replace(/[. ]+$/, '').trim();
  if (!stem || RESERVED.test(stem)) stem = stem ? `${stem}_` : 'document';
  if (stem.length > 180) stem = stem.slice(0, 180);
  return `${stem}-filled.pdf`;
}

export function ensurePdfExtension(name: string): string {
  return /\.pdf$/i.test(name) ? name : `${name}.pdf`;
}
