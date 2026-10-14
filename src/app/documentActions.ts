import { BRAND } from '@/brand';
import { detectFields, type DetectionResult } from '@/detect';
import { importNativeValues, readNativeFields } from '@/detect/acroform';
import { ExportError, type ExportWarning } from '@/export/errors';
import type { ExportResult } from '@/export/exportPdf';
import { exportFileName } from '@/export/filename';
import { setFields, summarizeFields } from '@/model/fields';
import { EMPTY_MODEL, type DocModel, type FormField } from '@/model/types';
import { openPdf, PdfLoadError, type OpenedPdf } from '@/pdf/loader';
import { pdfjs } from '@/pdf/pdfjs';
import { blankManagedNativeFields, PAGE_ANNOTATION_MODE } from '@/pdf/render';
import { platform, PlatformError, type PickedFile } from '@/platform';
import { documentState } from '@/state/document';
import { editor, selectIsDirty } from '@/state/editor';
import { askPassword, confirm, toast } from '@/state/feedback';
import { fillDefaults } from '@/state/prefs';
import { ui } from '@/state/ui';
import { ensureDocumentFonts } from '@/text/fontAssets';
import { sessions } from './sessions';

/**
 * Document-level workflows: open, export, close. Kept out of components so they
 * can be triggered from buttons, shortcuts, menus and drag-and-drop alike.
 */

let busy = false;

export function hasUnsavedWork(): boolean {
  return documentState().status === 'ready' && selectIsDirty(editor());
}

/** Asks before discarding unexported changes. Resolves true when it is safe to continue. */
async function confirmDiscard(action: string): Promise<boolean> {
  if (!hasUnsavedWork()) return true;
  const choice = await confirm({
    title: 'Replace the current document?',
    body: `“${documentState().file?.name ?? 'This document'}” has changes that haven’t been exported. They stay saved on this device, and you can resume them by opening the same file again.`,
    confirmLabel: action,
    altLabel: 'Export first',
    cancelLabel: 'Cancel',
  });
  if (choice === 'alt') return (await exportDocument()) === 'saved';
  return choice === true;
}

export async function openFromPicker(): Promise<void> {
  let picked: PickedFile | null;
  try {
    picked = await platform().pickPdf();
  } catch (err) {
    reportPlatformError(err, 'The file could not be opened.');
    return;
  }
  if (picked) await openPicked(picked);
}

export async function openPath(path: string): Promise<void> {
  try {
    await openPicked(await platform().openPath(path));
  } catch (err) {
    reportPlatformError(err, 'The file could not be opened.');
  }
}

export async function openPicked(picked: PickedFile): Promise<void> {
  if (busy) return;
  if (!(await confirmDiscard('Open new file'))) return;
  busy = true;
  const docs = documentState();
  docs.setLoading(picked.name);
  try {
    const opened = await openWithPasswordPrompts(picked);
    if (!opened) {
      docs.cancelLoading();
      return;
    }
    await ensureDocumentFonts();
    const native = await readAllNativeFields(opened);
    blankManagedNativeFields(opened.doc, native);

    // A resumed session already holds its reviewed fields; detect only for fresh opens.
    const restored = await offerRestore(opened, picked);
    const detection = restored ? null : await runDetection(opened, native);
    const imported = importNativeValues(setFields(EMPTY_MODEL, detection?.fields ?? native), fillDefaults());
    await sessions.persistNow();
    editor().reset(imported);
    if (restored) editor().commit('Restore session', () => restored);
    ui().resetForDocument();
    documentState().setReady(opened, { name: picked.name, path: picked.path });
    await sessions.attach(opened, picked, imported);
    if (detection) reportDetection(detection, native.length);
    if (opened.isXfa) {
      toast({
        tone: 'warning',
        title: 'Dynamic XFA form',
        body: 'This PDF contains an XFA form. FormFlow shows and fills its static pages; dynamic XFA behaviour is not supported.',
      });
    }
  } catch (err) {
    documentState().cancelLoading();
    if (err instanceof PdfLoadError) {
      toast({ tone: 'danger', title: `Couldn’t open “${picked.name}”`, body: err.message });
    } else {
      console.error('Opening failed', err instanceof Error ? err.name : 'unknown error');
      toast({ tone: 'danger', title: `Couldn’t open “${picked.name}”`, body: 'An unexpected error occurred while reading the file.' });
    }
  } finally {
    busy = false;
  }
}

async function openWithPasswordPrompts(picked: PickedFile): Promise<OpenedPdf | null> {
  let password: string | undefined;
  for (;;) {
    try {
      return await openPdf(picked.bytes, { password });
    } catch (err) {
      if (err instanceof PdfLoadError && (err.code === 'needs-password' || err.code === 'wrong-password')) {
        const next = await askPassword(picked.name, err.code === 'wrong-password');
        if (next === null) return null;
        password = next;
        continue;
      }
      throw err;
    }
  }
}

async function runDetection(opened: OpenedPdf, native: FormField[]): Promise<DetectionResult | null> {
  const docs = documentState();
  try {
    return await detectFields(opened, native, {
      onProgress: (done, total) => {
        if (total > 1) docs.setLoadingDetail(`Finding fields — page ${done} of ${total}`);
      },
    });
  } catch (err) {
    // Detection is an aid: the document still opens, fields can be added by hand.
    console.error('Field detection failed', err instanceof Error ? err.name : 'unknown error');
    toast({ tone: 'warning', title: 'Field detection didn’t finish', body: 'You can still fill the document and add fields by hand.' });
    return null;
  }
}

function reportDetection(result: DetectionResult, nativeCount: number): void {
  const pages = result.scannedPages.map((p) => p + 1);
  if (pages.length > 0) {
    const which = pages.length === 1 ? `Page ${pages[0]} looks` : `${pages.length} pages look`;
    toast({
      tone: 'warning',
      title: `${which} scanned`,
      body: `${BRAND.name} finds fields from a page’s text and drawn lines; scanned images have neither (there is no OCR). Use the tools to place text and marks directly.`,
    });
  }
  if (result.detectedCount > 0) {
    const native = nativeCount > 0 ? ` alongside ${nativeCount} form field${nativeCount === 1 ? '' : 's'}` : '';
    toast({
      tone: 'info',
      title: `${result.detectedCount} suggested field${result.detectedCount === 1 ? '' : 's'}${native}`,
      body: 'Found from labels and lines on the page. Review them in the Fields panel or start guided filling.',
    });
  }
}

async function readAllNativeFields(opened: OpenedPdf): Promise<FormField[]> {
  if (!opened.hasAcroForm) return [];
  const out: FormField[] = [];
  for (const geom of opened.pages) {
    const page = await opened.doc.getPage(geom.index + 1);
    out.push(...(await readNativeFields(page, geom)));
  }
  return out;
}

async function offerRestore(opened: OpenedPdf, picked: PickedFile): Promise<DocModel | null> {
  const saved = await sessions.load(opened.hash);
  if (!saved || !sessions.hasContent(saved)) return null;
  const when = new Date(saved.updatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const choice = await confirm({
    title: 'Resume where you left off?',
    body: `You worked on “${picked.name}” on ${when}. Restore your filled-in values and annotations?`,
    confirmLabel: 'Restore',
    cancelLabel: 'Start fresh',
  });
  if (choice === true) return saved.model;
  await sessions.discard(opened.hash);
  return null;
}

export async function closeDocument(): Promise<void> {
  if (documentState().status !== 'ready') return;
  if (!(await confirmDiscard('Close'))) return;
  await sessions.persistNow();
  sessions.detach();
  editor().reset(EMPTY_MODEL);
  ui().resetForDocument();
  documentState().close();
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export type ExportOutcome = 'saved' | 'cancelled' | 'failed';

/**
 * The Export button and shortcut: shows the review step when something still
 * needs attention (empty, skipped or uncertain fields), otherwise exports.
 */
export function requestExport(): void {
  if (documentState().status !== 'ready') return;
  const s = summarizeFields(editor().model);
  if (s.remaining + s.skipped + s.uncertain > 0) ui().openDialog({ kind: 'review' });
  else void exportDocument();
}

export async function exportDocument(): Promise<ExportOutcome> {
  const { pdf, file } = documentState();
  if (!pdf || !file || busy) return 'failed';
  busy = true;
  ui().setEditing(null);
  const model = editor().model;
  try {
    const fonts = await ensureDocumentFonts();
    const input = { bytes: pdf.bytes, pages: pdf.pages, model, fonts };
    // pdf-lib is only needed here, so it loads on the first export.
    const { exportPdf, exportRasterPdf } = await import('@/export/exportPdf');
    let result: ExportResult;
    try {
      result = await exportPdf(input);
    } catch (err) {
      if (!(err instanceof ExportError) || err.code !== 'encrypted') throw err;
      const go = await confirm({
        title: 'Export as a flattened copy?',
        body:
          'This PDF is encrypted, so its pages can’t be edited in place. FormFlow can export a new PDF that contains an image of each page with your additions on top. Text from the original pages will no longer be selectable or searchable.',
        confirmLabel: 'Export flattened copy',
      });
      if (go !== true) return 'cancelled';
      result = await exportRasterPdf(input, (i) => rasterizePage(pdf, i), { title: pdf.title });
    }
    await validateExport(result.bytes, pdf.pages.length);
    const saved = await platform().savePdf(result.bytes, exportFileName(file.name), file.path);
    if (!saved) return 'cancelled';
    if (editor().model === model) editor().markClean();
    documentState().setLastExport(saved);
    reportExport(saved, result.warnings);
    return 'saved';
  } catch (err) {
    if (err instanceof PlatformError) reportPlatformError(err, 'The PDF could not be saved.');
    else {
      console.error('Export failed', err instanceof Error ? err.name : 'unknown error');
      toast({
        tone: 'danger',
        title: 'Export failed',
        body: err instanceof ExportError ? err.message : 'Something went wrong while writing the PDF. Your work is still here.',
      });
    }
    return 'failed';
  } finally {
    busy = false;
  }
}

/** Re-opens the produced file with pdf.js to make sure it is a readable PDF. */
async function validateExport(bytes: Uint8Array, expectedPages: number): Promise<void> {
  let opened: OpenedPdf | null = null;
  try {
    opened = await openPdf(bytes);
    if (opened.pages.length !== expectedPages) {
      throw new ExportError('failed', `The exported file has ${opened.pages.length} pages instead of ${expectedPages}.`);
    }
    await opened.doc.getPage(1);
  } catch (err) {
    if (err instanceof ExportError) throw err;
    throw new ExportError('failed', 'The exported file could not be read back, so it was not saved.', err);
  } finally {
    if (opened) void opened.doc.destroy();
  }
}

/** Renders a page at 200 dpi to JPEG for the encrypted-PDF fallback. */
async function rasterizePage(pdf: OpenedPdf, index: number): Promise<{ data: Uint8Array; format: 'jpeg' }> {
  const page = await pdf.doc.getPage(index + 1);
  const viewport = page.getViewport({ scale: 200 / 72 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  // Native fields FormFlow manages are blank in storage; their values are drawn as vectors.
  await page.render({ canvas, viewport, annotationMode: PAGE_ANNOTATION_MODE, background: '#ffffff' }).promise;
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', 0.92),
  );
  canvas.width = canvas.height = 0;
  return { data: new Uint8Array(await blob.arrayBuffer()), format: 'jpeg' };
}

function reportExport(saved: { name: string; path: string | null }, warnings: ExportWarning[]): void {
  const reveal = saved.path && platform().revealFile ? saved.path : null;
  toast({
    tone: 'success',
    title: 'PDF exported',
    body: saved.name,
    action: reveal ? { label: platform().isMac ? 'Show in Finder' : 'Show in folder', run: () => void platform().revealFile!(reveal) } : undefined,
  });
  for (const w of warnings) {
    if (w.kind === 'missing-glyphs') {
      toast({
        tone: 'warning',
        title: 'Some characters were left out',
        body: `${BRAND.name}’s fonts don’t include: ${w.characters.slice(0, 12).join(' ')}. Those characters are missing from the export.`,
      });
    } else if (w.kind === 'native-field') {
      toast({ tone: 'warning', title: `Form field “${w.fieldName}”`, body: w.message });
    } else if (w.kind === 'xfa-removed') {
      toast({ tone: 'info', title: 'XFA form data removed', body: 'The exported PDF uses the static form so viewers show your values.' });
    }
  }
}

function reportPlatformError(err: unknown, fallback: string): void {
  if (err instanceof PlatformError) {
    const body =
      err.code === 'same-as-source'
        ? 'Choose a different file name — FormFlow never overwrites the original PDF.'
        : err.code === 'not-found'
          ? 'The file no longer exists at that location.'
          : err.code === 'not-pdf'
            ? 'Only PDF files can be opened.'
            : err.message;
    toast({ tone: 'danger', title: fallback, body });
    return;
  }
  toast({ tone: 'danger', title: fallback });
}

// pdf.js must be imported for side effects (worker configuration) before use.
void pdfjs;
