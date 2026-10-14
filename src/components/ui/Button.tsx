import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cx } from './cx';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  trailing?: ReactNode;
  loading?: boolean;
}

const variants: Record<Variant, string> = {
  primary:
    'bg-accent text-fg-on-accent shadow-[inset_0_1px_0_rgb(255_255_255/0.14),0_1px_2px_rgb(30_40_120/0.25)] hover:bg-accent-hover active:bg-accent-pressed disabled:bg-accent/45 disabled:shadow-none',
  secondary:
    'bg-elevated text-fg shadow-sm hover:bg-[color-mix(in_srgb,var(--ff-bg-elevated),var(--ff-fg)_4%)] active:bg-[color-mix(in_srgb,var(--ff-bg-elevated),var(--ff-fg)_7%)] disabled:text-fg-disabled',
  ghost: 'text-fg-secondary hover:bg-hover hover:text-fg active:bg-active disabled:text-fg-disabled disabled:hover:bg-transparent',
  subtle: 'bg-inset text-fg hover:bg-hover active:bg-active disabled:text-fg-disabled',
  danger: 'bg-danger text-white hover:brightness-105 active:brightness-95 disabled:opacity-50',
};

const sizes: Record<Size, string> = {
  sm: 'h-6 px-2 gap-1 text-xs rounded-sm',
  md: 'h-7 px-2.5 gap-1.5 text-sm rounded-sm',
  lg: 'h-8 px-3.5 gap-2 text-md rounded-md',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, trailing, loading, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium transition-[background-color,color,box-shadow,filter] duration-100',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner className="size-3.5" /> : icon}
      {children}
      {trailing}
    </button>
  );
});

export function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cx('animate-[ff-spin_0.8s_linear_infinite]', className)} aria-hidden>
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.22" strokeWidth="2" />
      <path d="M14 8a6 6 0 0 0-6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
