import { describe, expect, it } from 'vitest';
import { ensurePdfExtension, exportFileName } from './filename';

describe('exportFileName', () => {
  it('appends -filled and never returns the source name', () => {
    expect(exportFileName('lease.pdf')).toBe('lease-filled.pdf');
    expect(exportFileName('Tax Form.PDF')).toBe('Tax Form-filled.pdf');
    expect(exportFileName('/Users/me/docs/a.pdf')).toBe('a-filled.pdf');
    expect(exportFileName('C:\\x\\טופס.pdf')).toBe('טופס-filled.pdf');
  });
  it('sanitizes unsafe names', () => {
    expect(exportFileName('a:b?.pdf')).toBe('a_b_-filled.pdf');
    expect(exportFileName('con.pdf')).toBe('con_-filled.pdf');
    expect(exportFileName('')).toBe('document-filled.pdf');
    expect(exportFileName(null)).toBe('document-filled.pdf');
    expect(exportFileName('x'.repeat(300) + '.pdf').length).toBe(180 + '-filled.pdf'.length);
  });
  it('ensures a .pdf extension', () => {
    expect(ensurePdfExtension('out')).toBe('out.pdf');
    expect(ensurePdfExtension('out.PDF')).toBe('out.PDF');
  });
});
