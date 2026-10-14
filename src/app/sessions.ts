import { createStore, del, get, keys, set, clear, type UseStore } from 'idb-keyval';
import { create } from 'zustand';
import { BRAND } from '@/brand';
import type { DocModel } from '@/model/types';
import type { OpenedPdf } from '@/pdf/loader';
import { renderPageInto } from '@/pdf/render';
import { platform, type PickedFile } from '@/platform';
import { editor, useEditor } from '@/state/editor';
import { signatures } from '@/state/signatures';

/**
 * Local persistence: in-progress sessions (autosave + recovery) and recent documents.
 *
 * Everything lives in this device's IndexedDB and never leaves it. Sessions are
 * keyed by the SHA-256 of the source file, so reopening the same PDF offers to
 * resume. In the browser build, recent files' bytes are cached (bounded) because
 * the web platform cannot reopen files by path. "Clear local data" removes it all.
 */

export interface SavedSession {
  hash: string;
  name: string;
  model: DocModel;
  /** False when the stored model equals what the PDF opened with. */
  edited: boolean;
  updatedAt: number;
}

export interface RecentDocument {
  hash: string;
  name: string;
  path: string | null;
  pageCount: number;
  openedAt: number;
  /** Small JPEG data URL of the first page. */
  thumbnail: string | null;
  /** Browser build: the file's bytes are cached and it can be reopened. */
  cached: boolean;
}

const MAX_RECENTS = 8;
const MAX_CACHED_FILES = 4;
const MAX_CACHED_BYTES = 40 * 1024 * 1024;
const MAX_SESSIONS = 30;
const AUTOSAVE_DELAY_MS = 700;

let stores: { sessions: UseStore; files: UseStore; meta: UseStore } | null = null;
function db() {
  stores ??= {
    sessions: createStore(`${BRAND.storagePrefix}-sessions`, 'sessions'),
    files: createStore(`${BRAND.storagePrefix}-files`, 'files'),
    meta: createStore(`${BRAND.storagePrefix}-meta`, 'meta'),
  };
  return stores;
}

/** IndexedDB can be unavailable (private windows, test runners); persistence then degrades silently. */
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Recents (reactive, for the start screen)
// ---------------------------------------------------------------------------

interface RecentsState {
  items: RecentDocument[];
  loaded: boolean;
  /** Whether the last autosave succeeded; surfaced in the header status. */
  saveState: 'idle' | 'saving' | 'saved' | 'error';
}

export const useRecents = create<RecentsState>()(() => ({ items: [], loaded: false, saveState: 'idle' }));

async function loadRecents(): Promise<void> {
  const items = await safe(() => get<RecentDocument[]>('recents', db().meta), undefined);
  useRecents.setState({ items: items ?? [], loaded: true });
}

async function writeRecents(items: RecentDocument[]): Promise<void> {
  useRecents.setState({ items });
  await safe(() => set('recents', items, db().meta), undefined);
}

async function rememberRecent(opened: OpenedPdf, picked: PickedFile): Promise<void> {
  const web = platform().kind === 'web';
  const cacheable = web && picked.bytes.byteLength <= MAX_CACHED_BYTES;
  const previous = useRecents.getState().items;
  const existing = previous.find((r) => r.hash === opened.hash);
  const thumbnail = existing?.thumbnail ?? (await safe(() => makeThumbnail(opened), null));
  const entry: RecentDocument = {
    hash: opened.hash,
    name: picked.name,
    path: picked.path,
    pageCount: opened.pages.length,
    openedAt: Date.now(),
    thumbnail,
    cached: cacheable || (existing?.cached ?? false),
  };
  if (cacheable && !existing?.cached) await safe(() => set(opened.hash, picked.bytes, db().files), undefined);

  let items = [entry, ...previous.filter((r) => r.hash !== opened.hash)];
  // Bound the byte cache: only the most recent few files keep their bytes.
  let cachedCount = 0;
  const evict: string[] = [];
  items = items.map((r) => {
    if (!r.cached) return r;
    cachedCount++;
    if (cachedCount <= MAX_CACHED_FILES) return r;
    evict.push(r.hash);
    return { ...r, cached: false };
  });
  const dropped = items.slice(MAX_RECENTS);
  items = items.slice(0, MAX_RECENTS);
  for (const r of dropped) if (r.cached) evict.push(r.hash);
  await Promise.all(evict.map((h) => safe(() => del(h, db().files), undefined)));
  await writeRecents(items);
}

async function makeThumbnail(opened: OpenedPdf): Promise<string | null> {
  if (typeof document === 'undefined') return null;
  const page = await opened.doc.getPage(1);
  const geom = opened.pages[0]!;
  const canvas = document.createElement('canvas');
  const scale = 132 / Math.max(geom.width, geom.height);
  await renderPageInto(page, { canvas, scale, outputScale: 2 }).promise;
  const url = canvas.toDataURL('image/jpeg', 0.72);
  canvas.width = canvas.height = 0;
  return url;
}

export async function reopenRecent(r: RecentDocument): Promise<PickedFile | null> {
  if (r.path && platform().canOpenPaths) return platform().openPath(r.path);
  if (!r.cached) return null;
  const bytes = await safe(() => get<Uint8Array>(r.hash, db().files), undefined);
  return bytes ? { name: r.name, path: null, bytes } : null;
}

export async function forgetRecent(hash: string): Promise<void> {
  const entry = useRecents.getState().items.find((r) => r.hash === hash);
  if (entry?.path) await safe(() => platform().forgetPath?.(entry.path) ?? Promise.resolve(), undefined);
  await safe(() => del(hash, db().files), undefined);
  await writeRecents(useRecents.getState().items.filter((r) => r.hash !== hash));
}

/** Removes every session, cached file, recent entry and saved signature stored on this device. */
export async function clearLocalData(): Promise<void> {
  const d = db();
  await Promise.all([safe(() => clear(d.sessions), undefined), safe(() => clear(d.files), undefined), safe(() => clear(d.meta), undefined), signatures().clearAll(), safe(() => platform().forgetPath?.(null) ?? Promise.resolve(), undefined)]);
  useRecents.setState({ items: [] });
}

// ---------------------------------------------------------------------------
// Sessions (autosave)
// ---------------------------------------------------------------------------

interface Attached {
  hash: string;
  name: string;
  initial: DocModel;
  unsubscribe: () => void;
  timer: ReturnType<typeof setTimeout> | null;
}

let attached: Attached | null = null;

async function writeSession(a: Attached): Promise<void> {
  const { model, revision } = editor();
  const record: SavedSession = {
    hash: a.hash,
    name: a.name,
    model,
    edited: model !== a.initial,
    updatedAt: Date.now(),
  };
  useRecents.setState({ saveState: 'saving' });
  try {
    if (record.edited) await set(a.hash, record, db().sessions);
    else await del(a.hash, db().sessions);
    editor().markPersisted(revision);
    useRecents.setState({ saveState: 'saved' });
  } catch {
    useRecents.setState({ saveState: 'error' });
  }
}

async function pruneSessions(): Promise<void> {
  const all = await safe(() => keys<string>(db().sessions), [] as string[]);
  if (all.length <= MAX_SESSIONS) return;
  const records = await Promise.all(all.map((k) => safe(() => get<SavedSession>(k, db().sessions), undefined)));
  const sorted = records.filter((r): r is SavedSession => !!r).sort((x, y) => y.updatedAt - x.updatedAt);
  await Promise.all(sorted.slice(MAX_SESSIONS).map((r) => safe(() => del(r.hash, db().sessions), undefined)));
}

export const sessions = {
  init(): Promise<void> {
    return loadRecents();
  },

  load(hash: string): Promise<SavedSession | undefined> {
    return safe(() => get<SavedSession>(hash, db().sessions), undefined);
  },

  hasContent(saved: SavedSession): boolean {
    return saved.edited && (saved.model.annotationOrder.length > 0 || saved.model.fieldOrder.length > 0);
  },

  discard(hash: string): Promise<void> {
    return safe(() => del(hash, db().sessions), undefined);
  },

  async attach(opened: OpenedPdf, picked: PickedFile, initial: DocModel): Promise<void> {
    this.detach();
    const a: Attached = {
      hash: opened.hash,
      name: picked.name,
      initial,
      timer: null,
      unsubscribe: () => {},
    };
    a.unsubscribe = useEditor.subscribe((s, prev) => {
      if (s.model === prev.model || s.gestureBase) return;
      if (a.timer) clearTimeout(a.timer);
      a.timer = setTimeout(() => {
        a.timer = null;
        void writeSession(a);
      }, AUTOSAVE_DELAY_MS);
    });
    attached = a;
    useRecents.setState({ saveState: 'idle' });
    // A restored session differs from the initial model; persist it right away.
    if (editor().model !== initial) void writeSession(a);
    await rememberRecent(opened, picked);
    void pruneSessions();
  },

  /** Writes pending changes immediately (before closing or switching documents). */
  async persistNow(): Promise<void> {
    const a = attached;
    if (!a) return;
    if (a.timer) {
      clearTimeout(a.timer);
      a.timer = null;
    }
    const { revision, persistedRevision } = editor();
    if (revision !== persistedRevision) await writeSession(a);
  },

  detach(): void {
    if (!attached) return;
    if (attached.timer) clearTimeout(attached.timer);
    attached.unsubscribe();
    attached = null;
  },
};
