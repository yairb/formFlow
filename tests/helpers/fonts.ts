import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { FontLibrary, loadFontLibrary, setSharedFontLibrary } from '@/text/fonts';

const fontsDir = fileURLToPath(new URL('../../src/assets/fonts/', import.meta.url));
let lib: Promise<FontLibrary> | null = null;

/** Loads the bundled document fonts from disk and installs them as the shared library. */
export function loadTestFonts(): Promise<FontLibrary> {
  lib ??= loadFontLibrary(async (f) => new Uint8Array(await readFile(fontsDir + f))).then((l) => {
    setSharedFontLibrary(l);
    return l;
  });
  return lib;
}
