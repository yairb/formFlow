import * as TG from '@radix-ui/react-toggle-group';
import type { ReactNode } from 'react';
import { cx } from './cx';
import { Tooltip } from './Tooltip';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  /** Show only the icon, with the label as tooltip. */
  iconOnly?: boolean;
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  className,
  size = 'md',
}: {
  value: T | null;
  onChange(v: T): void;
  options: SegmentOption<T>[];
  ariaLabel: string;
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <TG.Root
      type="single"
      aria-label={ariaLabel}
      value={value ?? ''}
      onValueChange={(v) => v && onChange(v as T)}
      className={cx('inline-flex rounded-sm bg-inset p-0.5 shadow-[inset_0_0_0_1px_var(--ff-border-subtle)]', className)}
    >
      {options.map((o) => {
        const item = (
          <TG.Item
            key={o.value}
            value={o.value}
            aria-label={o.label}
            className={cx(
              'inline-flex flex-1 items-center justify-center gap-1.5 rounded-[5px] font-medium text-fg-secondary transition-[background-color,color,box-shadow] duration-100 hover:text-fg data-[state=on]:bg-elevated data-[state=on]:text-fg data-[state=on]:shadow-sm [&>svg]:size-3.5',
              size === 'sm' ? 'h-[22px] px-2 text-xs' : 'h-6 px-2.5 text-sm',
            )}
          >
            {o.icon}
            {!o.iconOnly && o.label}
          </TG.Item>
        );
        return o.iconOnly ? (
          <Tooltip key={o.value} label={o.label}>
            {item}
          </Tooltip>
        ) : (
          item
        );
      })}
    </TG.Root>
  );
}
