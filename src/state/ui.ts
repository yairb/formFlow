import { create } from 'zustand';
import type { Point, Rect } from '@/pdf/geometry';
import type { AnnotationId, FieldId } from '@/model/types';

export type Tool = 'select' | 'text' | 'check' | 'cross' | 'date' | 'signature' | 'draw' | 'highlight';

export type ZoomMode = 'fit-width' | 'fit-page' | 'custom';

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 5;

/** A text box that exists only in the editor until the user types into it. */
export interface TextDraft {
  pageIndex: number;
  at: Point;
  /** Set when the draft fills a form field (text is placed by the field's layout). */
  fieldId?: FieldId;
}

export type Editing = { kind: 'annotation'; id: AnnotationId } | { kind: 'draft'; draft: TextDraft } | null;

export interface ScrollRequest {
  pageIndex: number;
  /** Display-space rect to bring to the center; whole page top when absent. */
  rect?: Rect;
  smooth: boolean;
  nonce: number;
}

export type LeftPanel = 'pages' | 'fields';

export type DialogRequest =
  | { kind: 'signature'; place?: { pageIndex: number; at: Point; fieldId?: FieldId } }
  | { kind: 'review' }
  | { kind: 'settings' }
  | { kind: 'shortcuts' };

interface UiState {
  tool: Tool;
  zoomMode: ZoomMode;
  scale: number;
  selection: AnnotationId[];
  editing: Editing;
  /** Field focused in guided mode or selected on the page. */
  activeFieldId: FieldId | null;
  guided: boolean;
  /** Most-visible page in the workspace. */
  currentPage: number;
  leftPanel: LeftPanel;
  scrollRequest: ScrollRequest | null;
  /** Short status message in the header ("Undid move"). */
  status: { text: string; nonce: number } | null;
  dialog: DialogRequest | null;

  setTool(tool: Tool): void;
  setZoom(mode: ZoomMode, scale?: number): void;
  select(ids: AnnotationId[]): void;
  setEditing(e: Editing): void;
  setActiveField(id: FieldId | null): void;
  setGuided(on: boolean): void;
  setCurrentPage(i: number): void;
  setLeftPanel(p: LeftPanel): void;
  requestScroll(pageIndex: number, rect?: Rect, smooth?: boolean): void;
  flash(text: string): void;
  openDialog(d: DialogRequest | null): void;
  resetForDocument(): void;
}

let nonce = 0;

export const useUi = create<UiState>()((set) => ({
  tool: 'select',
  zoomMode: 'fit-width',
  scale: 1,
  selection: [],
  editing: null,
  activeFieldId: null,
  guided: false,
  currentPage: 0,
  leftPanel: 'pages',
  scrollRequest: null,
  status: null,
  dialog: null,

  setTool: (tool) => set({ tool, editing: null, ...(tool !== 'select' ? { selection: [] } : {}) }),
  setZoom: (zoomMode, scale) =>
    set((s) => ({
      zoomMode,
      scale: scale === undefined ? s.scale : Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale)),
    })),
  select: (selection) => set((s) => (sameIds(s.selection, selection) ? s : { selection })),
  setEditing: (editing) => set({ editing }),
  setActiveField: (activeFieldId) => set({ activeFieldId }),
  setGuided: (guided) => set({ guided }),
  setCurrentPage: (currentPage) => set((s) => (s.currentPage === currentPage ? s : { currentPage })),
  setLeftPanel: (leftPanel) => set({ leftPanel }),
  requestScroll: (pageIndex, rect, smooth = true) => set({ scrollRequest: { pageIndex, rect, smooth, nonce: ++nonce } }),
  flash: (text) => set({ status: { text, nonce: ++nonce } }),
  openDialog: (dialog) => set({ dialog }),
  resetForDocument: () =>
    set({
      tool: 'select',
      zoomMode: 'fit-width',
      selection: [],
      editing: null,
      activeFieldId: null,
      guided: false,
      currentPage: 0,
      scrollRequest: null,
      status: null,
      dialog: null,
    }),
}));

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

export const ui = () => useUi.getState();
