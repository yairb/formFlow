import * as RT from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';
import { Kbd } from './Kbd';

export const TooltipProvider = ({ children }: { children: ReactNode }) => (
  <RT.Provider delayDuration={450} skipDelayDuration={250}>
    {children}
  </RT.Provider>
);

export function Tooltip({
  label,
  shortcut,
  side = 'bottom',
  children,
  disabled,
}: {
  label: ReactNode;
  shortcut?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  children: ReactNode;
  disabled?: boolean;
}) {
  if (disabled) return <>{children}</>;
  return (
    <RT.Root>
      <RT.Trigger asChild>{children}</RT.Trigger>
      <RT.Portal>
        <RT.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="ff-animate-fade z-[var(--ff-z-tooltip)] flex items-center gap-2 rounded-sm bg-[#1c1c1f] px-2 py-1 text-xs font-medium text-white shadow-md dark:bg-[#3a3b40]"
        >
          {label}
          {shortcut && <Kbd tone="dark">{shortcut}</Kbd>}
        </RT.Content>
      </RT.Portal>
    </RT.Root>
  );
}
