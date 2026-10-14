import * as DM from '@radix-ui/react-dropdown-menu';
import type { ReactNode } from 'react';
import { cx } from './cx';
import { Kbd } from './Kbd';

export const Menu = DM.Root;
export const MenuTrigger = DM.Trigger;

export function MenuContent({ children, align = 'end', className }: { children: ReactNode; align?: 'start' | 'end' | 'center'; className?: string }) {
  return (
    <DM.Portal>
      <DM.Content
        align={align}
        sideOffset={6}
        collisionPadding={8}
        className={cx('ff-animate-pop z-[var(--ff-z-popover)] min-w-[200px] rounded-md bg-elevated p-1 shadow-md', className)}
      >
        {children}
      </DM.Content>
    </DM.Portal>
  );
}

export function MenuItem({
  children,
  icon,
  shortcut,
  onSelect,
  disabled,
  tone,
}: {
  children: ReactNode;
  icon?: ReactNode;
  shortcut?: string;
  onSelect(): void;
  disabled?: boolean;
  tone?: 'danger';
}) {
  return (
    <DM.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cx(
        'flex h-7 items-center gap-2 rounded-sm px-2 text-sm outline-none data-[disabled]:text-fg-disabled data-[highlighted]:bg-hover [&>svg]:size-4 [&>svg]:stroke-[1.75]',
        tone === 'danger' ? 'text-danger' : 'text-fg',
      )}
    >
      {icon}
      <span className="flex-1">{children}</span>
      {shortcut && <Kbd>{shortcut}</Kbd>}
    </DM.Item>
  );
}

export function MenuSeparator() {
  return <DM.Separator className="mx-1 my-1 h-px bg-line-subtle" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <DM.Label className="px-2 pb-1 pt-1.5 text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">{children}</DM.Label>;
}
