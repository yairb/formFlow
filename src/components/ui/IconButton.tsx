import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cx } from './cx';
import { Tooltip } from './Tooltip';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  shortcut?: string;
  active?: boolean;
  size?: 'sm' | 'md' | 'lg';
  tooltipSide?: 'top' | 'bottom' | 'left' | 'right';
  children: ReactNode;
}

const sizes = { sm: 'size-6 rounded-xs', md: 'size-7 rounded-sm', lg: 'size-8 rounded-md' };

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, shortcut, active, size = 'md', tooltipSide, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <Tooltip label={label} shortcut={shortcut} side={tooltipSide}>
      <button
        ref={ref}
        type={type}
        aria-label={label}
        aria-pressed={active ?? undefined}
        className={cx(
          'inline-flex shrink-0 items-center justify-center transition-[background-color,color] duration-100 [&>svg]:size-4 [&>svg]:stroke-[1.75]',
          active
            ? 'bg-accent-soft text-accent-fg'
            : 'text-fg-secondary hover:bg-hover hover:text-fg active:bg-active disabled:text-fg-disabled disabled:hover:bg-transparent',
          sizes[size],
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    </Tooltip>
  );
});
