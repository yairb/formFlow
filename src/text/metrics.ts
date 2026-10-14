/**
 * Vertical text metrics shared by the on-screen editor and the PDF exporter.
 *
 * The values match the typo metrics of the bundled Noto fonts and are forced onto
 * the browser with `ascent-override`/`descent-override` (see document-fonts.css), so
 * a baseline computed here is exactly where the browser draws it.
 */
export const LINE_HEIGHT = 1.25;
export const ASCENT = 1.069;
export const DESCENT = 0.293;

/** Distance from the top of a line box to its baseline, in points. */
export function baselineOffset(fontSize: number): number {
  return ((LINE_HEIGHT - (ASCENT + DESCENT)) / 2 + ASCENT) * fontSize;
}

export function lineHeightPt(fontSize: number): number {
  return LINE_HEIGHT * fontSize;
}

/**
 * OpenType features disabled for document text. pdf-lib draws glyph advances without
 * kerning, so the editor disables kerning and ligatures too (see .ff-doc-text).
 */
export const DOC_TEXT_FEATURES: Record<string, boolean> = {
  liga: false,
  clig: false,
  dlig: false,
  calt: false,
  kern: false,
};
