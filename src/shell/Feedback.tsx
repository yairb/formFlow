import { AlertTriangle, CheckCircle2, Info, KeyRound, X, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Field';
import { cx } from '@/components/ui/cx';
import { useFeedback, type ConfirmRequest, type PasswordRequest, type Toast } from '@/state/feedback';
import { useUi } from '@/state/ui';

const TONE_ICON = {
  info: <Info className="size-4 text-fg-secondary" />,
  success: <CheckCircle2 className="size-4 text-success" />,
  warning: <AlertTriangle className="size-4 text-warning" />,
  danger: <XCircle className="size-4 text-danger" />,
};

export function Toasts() {
  const toasts = useFeedback((s) => s.toasts);
  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[var(--ff-z-toast)] flex w-[360px] max-w-[calc(100vw-32px)] flex-col gap-2"
      role="region"
      aria-label="Notifications"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} t={t} />
      ))}
    </div>
  );
}

function ToastItem({ t }: { t: Toast }) {
  const dismiss = useFeedback((s) => s.dismiss);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (!t.duration || paused) return;
    const id = setTimeout(() => dismiss(t.id), t.duration);
    return () => clearTimeout(id);
  }, [t.id, t.duration, paused, dismiss]);
  return (
    <div
      role={t.tone === 'danger' ? 'alert' : 'status'}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      className="ff-animate-slide-up pointer-events-auto flex items-start gap-2.5 rounded-md bg-elevated px-3 py-2.5 shadow-lg"
    >
      <span className="mt-px shrink-0">{TONE_ICON[t.tone]}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-fg">{t.title}</div>
        {t.body && <div className="mt-0.5 text-sm leading-[1.4] text-fg-secondary">{t.body}</div>}
        {t.action && (
          <button
            type="button"
            className="mt-1.5 text-sm font-medium text-accent-fg hover:underline"
            onClick={() => {
              t.action!.run();
              dismiss(t.id);
            }}
          >
            {t.action.label}
          </button>
        )}
      </div>
      <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="-mr-1 shrink-0 rounded-xs p-0.5 text-fg-tertiary hover:bg-hover hover:text-fg">
        <X className="size-3.5" />
      </button>
    </div>
  );
}

export function Modals() {
  const modal = useFeedback((s) => s.modal);
  if (!modal) return null;
  return modal.kind === 'confirm' ? <ConfirmDialog key="confirm" req={modal} /> : <PasswordDialog key={`pw${modal.retry}`} req={modal} />;
}

function ConfirmDialog({ req }: { req: ConfirmRequest }) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && req.resolve(false)}
      title={req.title}
      description={req.body}
      initialFocus={() => confirmRef.current}
      footer={
        <>
          {req.altLabel && (
            <Button variant="ghost" className="mr-auto" onClick={() => req.resolve('alt')}>
              {req.altLabel}
            </Button>
          )}
          <Button onClick={() => req.resolve(false)}>{req.cancelLabel ?? 'Cancel'}</Button>
          <Button ref={confirmRef} variant={req.tone === 'danger' ? 'danger' : 'primary'} onClick={() => req.resolve(true)}>
            {req.confirmLabel}
          </Button>
        </>
      }
    />
  );
}

function PasswordDialog({ req }: { req: PasswordRequest }) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const submit = () => value && req.resolve(value);
  return (
    <Dialog
      open
      width={400}
      onOpenChange={(o) => !o && req.resolve(null)}
      title={
        <span className="flex items-center gap-2">
          <KeyRound className="size-4 text-fg-secondary" /> Password required
        </span>
      }
      description={`“${req.fileName}” is protected. Enter its password to open it. The password is used only on this device and isn’t stored.`}
      initialFocus={() => inputRef.current}
      footer={
        <>
          <Button onClick={() => req.resolve(null)}>Cancel</Button>
          <Button variant="primary" disabled={!value} onClick={submit}>
            Open
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Input
          ref={inputRef}
          type="password"
          autoComplete="off"
          aria-label="Document password"
          aria-invalid={req.retry || undefined}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className={cx(req.retry && 'shadow-[inset_0_0_0_1.5px_var(--ff-danger)]')}
        />
        {req.retry && <p className="mt-1.5 text-xs text-danger">That password didn’t work. Try again.</p>}
      </form>
    </Dialog>
  );
}

/** Short-lived status line ("Undid move", "Moved") announced to screen readers. */
export function StatusFlash() {
  const status = useUi((s) => s.status);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!status) return;
    setVisible(true);
    const id = setTimeout(() => setVisible(false), 1600);
    return () => clearTimeout(id);
  }, [status]);
  return (
    <div aria-live="polite" className="pointer-events-none">
      {status && visible && (
        <div key={status.nonce} className="ff-animate-fade rounded-md bg-[#1c1c1f]/88 px-2.5 py-1 text-xs font-medium text-white shadow-sm dark:bg-[#3a3b40]/92">
          {status.text}
        </div>
      )}
    </div>
  );
}
