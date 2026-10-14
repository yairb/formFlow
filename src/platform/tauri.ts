import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ensurePdfExtension } from '@/export/filename';
import { PlatformError, type Platform, type PickedFile } from './types';

interface PickResult {
  path: string;
  name: string;
}

function toPlatformError(err: unknown): PlatformError {
  // Rust commands reject with "code: message".
  const text = typeof err === 'string' ? err : err instanceof Error ? err.message : String(err);
  const m = /^(same-as-source|not-pdf|not-found|not-allowed|io):\s*(.*)$/s.exec(text);
  if (m) return new PlatformError(m[1] as PlatformError['code'], m[2]!);
  return new PlatformError('io', text);
}

async function readGranted(path: string, name: string): Promise<PickedFile> {
  try {
    const buf = await invoke<ArrayBuffer>('read_pdf', { path });
    return { name, path, bytes: new Uint8Array(buf) };
  } catch (err) {
    throw toPlatformError(err);
  }
}

export function createTauriPlatform(): Platform {
  return {
    kind: 'desktop',
    isMac: navigator.userAgent.includes('Mac'),
    canOpenPaths: true,

    async pickPdf() {
      let picked: PickResult | null;
      try {
        picked = await invoke<PickResult | null>('pick_pdf');
      } catch (err) {
        throw toPlatformError(err);
      }
      return picked ? readGranted(picked.path, picked.name) : null;
    },

    openPath(path) {
      const name = path.split(/[\\/]/).pop() ?? 'document.pdf';
      return readGranted(path, name);
    },

    async savePdf(bytes, suggestedName, sourcePath) {
      try {
        const result = await invoke<PickResult | null>('save_pdf', bytes, {
          headers: {
            'x-suggested-name': encodeURIComponent(ensurePdfExtension(suggestedName)),
            'x-source-path': encodeURIComponent(sourcePath ?? ''),
          },
        });
        return result ? { name: result.name, path: result.path } : null;
      } catch (err) {
        throw toPlatformError(err);
      }
    },

    async forgetPath(path) {
      await invoke('forget_path', { path });
    },

    async revealFile(path) {
      await invoke('reveal_file', { path });
    },

    onCloseRequested(shouldClose) {
      let unlisten: (() => void) | null = null;
      let disposed = false;
      void getCurrentWindow()
        .onCloseRequested(async (event) => {
          if (!(await shouldClose())) event.preventDefault();
        })
        .then((fn) => {
          if (disposed) fn();
          else unlisten = fn;
        });
      return () => {
        disposed = true;
        unlisten?.();
      };
    },
  };
}
