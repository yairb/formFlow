import * as RD from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from './cx';

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = 440,
  dismissible = true,
  initialFocus,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  width?: number;
  dismissible?: boolean;
  /** Element to focus on open (defaults to Radix: first focusable). */
  initialFocus?: () => HTMLElement | null;
}) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="ff-animate-fade fixed inset-0 z-[var(--ff-z-dialog)] bg-[rgb(18_18_22/0.32)] backdrop-blur-[1.5px] dark:bg-black/50" />
        <RD.Content
          onEscapeKeyDown={(e) => !dismissible && e.preventDefault()}
          onPointerDownOutside={(e) => !dismissible && e.preventDefault()}
          onOpenAutoFocus={(e) => {
            const el = initialFocus?.();
            if (el) {
              e.preventDefault();
              el.focus();
            }
          }}
          style={{ width }}
          className="ff-animate-pop fixed left-1/2 top-[18vh] z-[var(--ff-z-dialog)] flex max-h-[76vh] max-w-[calc(100vw-32px)] -translate-x-1/2 flex-col overflow-hidden rounded-lg bg-elevated shadow-lg"
        >
          <div className="flex items-start gap-3 px-5 pb-1 pt-4">
            <div className="min-w-0 flex-1">
              <RD.Title className="text-lg font-semibold tracking-[-0.01em] text-fg">{title}</RD.Title>
              {description ? (
                <RD.Description className="mt-1 text-sm text-fg-secondary">{description}</RD.Description>
              ) : (
                <RD.Description className="sr-only">{typeof title === 'string' ? title : ''}</RD.Description>
              )}
            </div>
            {dismissible && (
              <RD.Close
                aria-label="Close"
                className="-mr-1.5 -mt-0.5 inline-flex size-7 items-center justify-center rounded-sm text-fg-tertiary hover:bg-hover hover:text-fg"
              >
                <X className="size-4" />
              </RD.Close>
            )}
          </div>
          {children && <div className={cx('scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-3')}>{children}</div>}
          {footer && <div className="flex items-center justify-end gap-2 px-5 pb-4 pt-2">{footer}</div>}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
