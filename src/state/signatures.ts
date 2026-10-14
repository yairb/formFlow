import { clear, createStore, get, set, type UseStore } from 'idb-keyval';
import { create } from 'zustand';
import { BRAND } from '@/brand';
import { newId } from '@/model/ids';
import type { SignatureImage } from '@/model/types';

/**
 * Signature images the user created. They are kept in memory for the session and,
 * only when the user opts in ("Remember on this device"), in local IndexedDB.
 * Signatures are images placed on the page — not cryptographic digital signatures.
 */
export interface SavedSignature {
  id: string;
  image: SignatureImage;
  source: 'draw' | 'type' | 'image';
  createdAt: number;
  remembered: boolean;
}

interface SignatureState {
  items: SavedSignature[];
  /** Signature the Signature tool places. */
  activeId: string | null;
  loaded: boolean;
  add(image: SignatureImage, source: SavedSignature['source'], remember: boolean): SavedSignature;
  remove(id: string): void;
  setActive(id: string | null): void;
  load(): Promise<void>;
  /** Forgets every signature, in memory and on disk. */
  clearAll(): Promise<void>;
}

let store: UseStore | null = null;
const db = () => (store ??= createStore(`${BRAND.storagePrefix}-signatures`, 'signatures'));

function persist(items: SavedSignature[]): void {
  const remembered = items.filter((s) => s.remembered);
  void set('items', remembered, db()).catch(() => {});
}

export const useSignatures = create<SignatureState>()((setState, getState) => ({
  items: [],
  activeId: null,
  loaded: false,
  add(image, source, remember) {
    const sig: SavedSignature = { id: newId('sg'), image, source, createdAt: Date.now(), remembered: remember };
    const items = [sig, ...getState().items];
    setState({ items, activeId: sig.id });
    if (remember) persist(items);
    return sig;
  },
  remove(id) {
    const items = getState().items.filter((s) => s.id !== id);
    setState((s) => ({ items, activeId: s.activeId === id ? (items[0]?.id ?? null) : s.activeId }));
    persist(items);
  },
  setActive(activeId) {
    setState({ activeId });
  },
  async load() {
    if (getState().loaded) return;
    try {
      const saved = (await get<SavedSignature[]>('items', db())) ?? [];
      setState((s) => ({ items: [...s.items, ...saved.filter((x) => !s.items.some((y) => y.id === x.id))], loaded: true }));
    } catch {
      setState({ loaded: true });
    }
  },
  async clearAll() {
    setState({ items: [], activeId: null });
    await clear(db()).catch(() => {});
  },
}));

export const signatures = () => useSignatures.getState();

export function activeSignature(): SavedSignature | null {
  const s = signatures();
  return s.items.find((x) => x.id === s.activeId) ?? null;
}
