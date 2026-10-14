import { create } from 'zustand';
import type { OpenedPdf } from '@/pdf/loader';

export interface SourceFile {
  name: string;
  /** Desktop path; null for browser-picked or dropped files. */
  path: string | null;
}

interface DocumentState {
  status: 'empty' | 'loading' | 'ready';
  loadingName: string | null;
  /** Second line of the loading indicator, e.g. detection progress. */
  loadingDetail: string | null;
  pdf: OpenedPdf | null;
  file: SourceFile | null;
  /** Increments for every opened document; keys per-document views. */
  session: number;
  lastExport: { name: string; path: string | null } | null;

  setLoading(name: string): void;
  setLoadingDetail(detail: string | null): void;
  cancelLoading(): void;
  setReady(pdf: OpenedPdf, file: SourceFile): void;
  setLastExport(e: DocumentState['lastExport']): void;
  close(): void;
}

export const useDocument = create<DocumentState>()((set, get) => ({
  status: 'empty',
  loadingName: null,
  loadingDetail: null,
  pdf: null,
  file: null,
  session: 0,
  lastExport: null,

  setLoading: (loadingName) => set({ status: 'loading', loadingName, loadingDetail: null }),
  setLoadingDetail: (loadingDetail) => set({ loadingDetail }),
  cancelLoading: () => set((s) => ({ status: s.pdf ? 'ready' : 'empty', loadingName: null, loadingDetail: null })),
  setReady: (pdf, file) => {
    const prev = get().pdf;
    set((s) => ({ status: 'ready', loadingName: null, loadingDetail: null, pdf, file, session: s.session + 1, lastExport: null }));
    if (prev && prev !== pdf) void prev.doc.destroy();
  },
  setLastExport: (lastExport) => set({ lastExport }),
  close: () => {
    const prev = get().pdf;
    set((s) => ({ status: 'empty', pdf: null, file: null, loadingName: null, session: s.session + 1, lastExport: null }));
    if (prev) void prev.doc.destroy();
  },
}));

export const documentState = () => useDocument.getState();
