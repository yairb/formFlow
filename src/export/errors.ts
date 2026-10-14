// Kept apart from exportPdf.ts so callers can check errors without loading pdf-lib.

export type ExportWarning =
  | { kind: 'missing-glyphs'; characters: string[] }
  | { kind: 'native-field'; fieldName: string; message: string }
  | { kind: 'xfa-removed' };

export type ExportErrorCode = 'encrypted' | 'unreadable' | 'failed';

export class ExportError extends Error {
  readonly code: ExportErrorCode;
  constructor(code: ExportErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'ExportError';
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}
