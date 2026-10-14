import { create } from 'zustand';
import { EMPTY_MODEL, type DocModel } from '@/model/types';

/**
 * Document editing state with undo/redo.
 *
 * History stores immutable model snapshots (structural sharing keeps them cheap);
 * it never depends on DOM state. Continuous interactions (drag, resize, typing)
 * run as a *gesture*: intermediate updates are applied live but only one history
 * entry is recorded when the gesture ends.
 */
export interface HistoryEntry {
  label: string;
  model: DocModel;
}

const HISTORY_LIMIT = 200;
const MERGE_WINDOW_MS = 900;

interface EditorState {
  model: DocModel;
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** Increments on every model change. */
  revision: number;
  /** Revision last written to the local session store. */
  persistedRevision: number;
  /**
   * Snapshot that has no unsaved changes (the opened document, or the last export).
   * Undo restores exact snapshots, so `model !== cleanModel` is a precise dirty check.
   */
  cleanModel: DocModel;
  gestureBase: DocModel | null;
  lastMerge: { key: string; at: number } | null;

  reset(model?: DocModel): void;
  commit(label: string, recipe: (m: DocModel) => DocModel, opts?: { mergeKey?: string }): boolean;
  beginGesture(): void;
  updateGesture(recipe: (m: DocModel) => DocModel): void;
  endGesture(label: string): boolean;
  cancelGesture(): void;
  undo(): string | null;
  redo(): string | null;
  /**
   * Drops the most recent history entry and restores its model, without making it
   * redoable. Used when an edit turns out to be a no-op (e.g. a text box that was
   * created and then emptied before the user left it).
   */
  discardLast(): boolean;
  markPersisted(revision: number): void;
  /** Marks the current model as exported / saved. */
  markClean(): void;
}

export const useEditor = create<EditorState>()((set, get) => ({
  model: EMPTY_MODEL,
  past: [],
  future: [],
  revision: 0,
  persistedRevision: 0,
  cleanModel: EMPTY_MODEL,
  gestureBase: null,
  lastMerge: null,

  reset(model = EMPTY_MODEL) {
    set({
      model,
      past: [],
      future: [],
      revision: 0,
      persistedRevision: 0,
      cleanModel: model,
      gestureBase: null,
      lastMerge: null,
    });
  },

  commit(label, recipe, opts) {
    const s = get();
    if (s.gestureBase) s.endGesture('Edit');
    const current = get().model;
    const next = recipe(current);
    if (next === current) return false;
    const now = Date.now();
    const merge =
      opts?.mergeKey && s.lastMerge?.key === opts.mergeKey && now - s.lastMerge.at < MERGE_WINDOW_MS && get().past.length > 0;
    set((st) => ({
      model: next,
      past: merge ? st.past : [...st.past, { label, model: current }].slice(-HISTORY_LIMIT),
      future: [],
      revision: st.revision + 1,
      lastMerge: opts?.mergeKey ? { key: opts.mergeKey, at: now } : null,
    }));
    return true;
  },

  beginGesture() {
    if (get().gestureBase) return;
    set((st) => ({ gestureBase: st.model }));
  },

  updateGesture(recipe) {
    const s = get();
    if (!s.gestureBase) s.beginGesture();
    const next = recipe(get().model);
    if (next === get().model) return;
    set((st) => ({ model: next, revision: st.revision + 1 }));
  },

  endGesture(label) {
    const { gestureBase, model } = get();
    if (!gestureBase) return false;
    if (gestureBase === model) {
      set({ gestureBase: null });
      return false;
    }
    set((st) => ({
      gestureBase: null,
      past: [...st.past, { label, model: gestureBase }].slice(-HISTORY_LIMIT),
      future: [],
      lastMerge: null,
    }));
    return true;
  },

  cancelGesture() {
    const { gestureBase } = get();
    if (!gestureBase) return;
    set((st) => ({ model: gestureBase, gestureBase: null, revision: st.revision + 1 }));
  },

  undo() {
    const s = get();
    if (s.gestureBase) s.endGesture('Edit');
    const { past, model } = get();
    const entry = past[past.length - 1];
    if (!entry) return null;
    set((st) => ({
      model: entry.model,
      past: st.past.slice(0, -1),
      future: [...st.future, { label: entry.label, model }],
      revision: st.revision + 1,
      lastMerge: null,
    }));
    return entry.label;
  },

  redo() {
    const { future, model } = get();
    const entry = future[future.length - 1];
    if (!entry) return null;
    set((st) => ({
      model: entry.model,
      future: st.future.slice(0, -1),
      past: [...st.past, { label: entry.label, model }],
      revision: st.revision + 1,
      lastMerge: null,
    }));
    return entry.label;
  },

  discardLast() {
    const { past } = get();
    const entry = past[past.length - 1];
    if (!entry) return false;
    set((st) => ({
      model: entry.model,
      past: st.past.slice(0, -1),
      revision: st.revision + 1,
      lastMerge: null,
    }));
    return true;
  },

  markPersisted(revision) {
    set({ persistedRevision: revision });
  },

  markClean() {
    set((st) => ({ cleanModel: st.model }));
  },
}));

export const editor = () => useEditor.getState();

/** True when the document has changes that have not been exported. */
export const selectIsDirty = (s: Pick<EditorState, 'model' | 'cleanModel'>) => s.model !== s.cleanModel;
