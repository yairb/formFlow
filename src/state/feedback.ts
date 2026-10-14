import { create } from 'zustand';

/**
 * Toasts and modal requests (confirm / password). Modal requests are promises so
 * workflows read sequentially: `if (!(await confirm({...}))) return;`.
 */
export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

export interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  body?: string;
  action?: { label: string; run: () => void };
  /** ms; 0 keeps it until dismissed. */
  duration: number;
}

export interface ConfirmRequest {
  kind: 'confirm';
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Optional third choice, e.g. "Export first". Resolves to 'alt'. */
  altLabel?: string;
  tone?: 'default' | 'danger';
  resolve(v: boolean | 'alt'): void;
}

export interface PasswordRequest {
  kind: 'password';
  fileName: string;
  retry: boolean;
  resolve(v: string | null): void;
}

export type ModalRequest = ConfirmRequest | PasswordRequest;

interface FeedbackState {
  toasts: Toast[];
  modal: ModalRequest | null;
  toast(t: Omit<Toast, 'id' | 'duration'> & { duration?: number }): number;
  dismiss(id: number): void;
  setModal(m: ModalRequest | null): void;
}

let toastId = 0;

export const useFeedback = create<FeedbackState>()((set) => ({
  toasts: [],
  modal: null,
  toast: (t) => {
    const id = ++toastId;
    const duration = t.duration ?? (t.tone === 'danger' || t.action ? 8000 : 4200);
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id, duration }] }));
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setModal: (modal) => set({ modal }),
}));

export const toast = (t: Parameters<FeedbackState['toast']>[0]) => useFeedback.getState().toast(t);

export function confirm(req: Omit<ConfirmRequest, 'kind' | 'resolve'>): Promise<boolean | 'alt'> {
  return new Promise((resolve) => {
    useFeedback.getState().setModal({
      kind: 'confirm',
      ...req,
      resolve: (v) => {
        useFeedback.getState().setModal(null);
        resolve(v);
      },
    });
  });
}

export function askPassword(fileName: string, retry: boolean): Promise<string | null> {
  return new Promise((resolve) => {
    useFeedback.getState().setModal({
      kind: 'password',
      fileName,
      retry,
      resolve: (v) => {
        useFeedback.getState().setModal(null);
        resolve(v);
      },
    });
  });
}
