import { loadFontLibrary, setSharedFontLibrary, type FontLibrary } from './fonts';

// Vite resolves these to hashed asset URLs; files are bundled with the app (no network).
const urls = import.meta.glob('../assets/fonts/*.ttf', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function urlFor(fileName: string): string {
  const entry = Object.entries(urls).find(([path]) => path.endsWith(`/${fileName}`));
  if (!entry) throw new Error(`Missing bundled font ${fileName}`);
  return entry[1];
}

let pending: Promise<FontLibrary> | null = null;

/** Loads document fonts once, for both layout and export, and waits for CSS faces. */
export function ensureDocumentFonts(): Promise<FontLibrary> {
  pending ??= (async () => {
    const lib = await loadFontLibrary(async (file) => {
      const res = await fetch(urlFor(file));
      if (!res.ok) throw new Error(`Could not load font ${file}`);
      return new Uint8Array(await res.arrayBuffer());
    });
    setSharedFontLibrary(lib);
    if (typeof document !== 'undefined' && document.fonts) {
      await Promise.allSettled([
        document.fonts.load("16px 'FF Doc Sans'", 'Aa'),
        document.fonts.load("bold 16px 'FF Doc Sans'", 'Aa'),
        document.fonts.load("16px 'FF Doc Sans'", 'שלום'),
        document.fonts.load("16px 'FF Doc Serif'", 'Aa'),
      ]);
    }
    return lib;
  })();
  return pending;
}
