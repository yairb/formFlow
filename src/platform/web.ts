import { ensurePdfExtension } from '@/export/filename';
import { PlatformError, type Platform, type PickedFile } from './types';

interface FilePickerWindow {
  showOpenFilePicker?: (opts: unknown) => Promise<{ getFile(): Promise<File> }[]>;
  showSaveFilePicker?: (opts: unknown) => Promise<{
    name: string;
    createWritable(): Promise<{ write(data: BufferSource): Promise<void>; close(): Promise<void> }>;
  }>;
}

const PDF_TYPES = [{ description: 'PDF document', accept: { 'application/pdf': ['.pdf'] } }];

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function pickWithInput(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf,.pdf';
    input.style.display = 'none';
    let settled = false;
    const done = (f: File | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(f);
    };
    input.addEventListener('change', () => done(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => done(null));
    document.body.appendChild(input);
    input.click();
  });
}

export async function fileToPicked(file: File): Promise<PickedFile> {
  return { name: file.name, path: null, bytes: new Uint8Array(await file.arrayBuffer()) };
}

export function createWebPlatform(): Platform {
  const w = window as unknown as FilePickerWindow;
  return {
    kind: 'web',
    isMac: /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent),
    canOpenPaths: false,

    async pickPdf() {
      if (w.showOpenFilePicker) {
        try {
          const [handle] = await w.showOpenFilePicker({ types: PDF_TYPES, multiple: false });
          return handle ? fileToPicked(await handle.getFile()) : null;
        } catch (err) {
          if (isAbort(err)) return null;
          // Fall through to the classic input (e.g. picker blocked in an iframe).
        }
      }
      const file = await pickWithInput();
      return file ? fileToPicked(file) : null;
    },

    openPath() {
      return Promise.reject(new PlatformError('not-allowed', 'Opening files by path is only available in the desktop app.'));
    },

    async savePdf(bytes, suggestedName) {
      const name = ensurePdfExtension(suggestedName);
      if (w.showSaveFilePicker) {
        try {
          const handle = await w.showSaveFilePicker({ suggestedName: name, types: PDF_TYPES });
          const writable = await handle.createWritable();
          await writable.write(bytes as unknown as BufferSource);
          await writable.close();
          return { name: handle.name, path: null };
        } catch (err) {
          if (isAbort(err)) return null;
          // Fall back to a download.
        }
      }
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      return { name, path: null };
    },

    onCloseRequested(_shouldClose, hasUnsaved) {
      const handler = (e: BeforeUnloadEvent) => {
        if (!hasUnsaved()) return;
        e.preventDefault();
        e.returnValue = '';
      };
      window.addEventListener('beforeunload', handler);
      return () => window.removeEventListener('beforeunload', handler);
    },
  };
}
