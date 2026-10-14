import * as RP from '@radix-ui/react-popover';
import type { ReactNode } from 'react';
import { cx } from './cx';

export const Popover = RP.Root;
export const PopoverTrigger = RP.Trigger;
export const PopoverAnchor = RP.Anchor;

export function PopoverContent({
  children,
  className,
  side = 'bottom',
  align = 'center',
  onOpenAutoFocus,
}: {
  children: ReactNode;
  className?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  onOpenAutoFocus?: (e: Event) => void;
}) {
  return (
    <RP.Portal>
      <RP.Content
        side={side}
        align={align}
        sideOffset={8}
        collisionPadding={10}
        onOpenAutoFocus={onOpenAutoFocus}
        className={cx('ff-animate-pop z-[var(--ff-z-popover)] rounded-md bg-elevated p-3 shadow-md', className)}
      >
        {children}
      </RP.Content>
    </RP.Portal>
  );
}
