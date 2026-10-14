import { cx } from './cx';

export function Kbd({ children, tone = 'light', className }: { children: string; tone?: 'light' | 'dark'; className?: string }) {
  return (
    <kbd
      className={cx(
        'inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-[4px] px-1 font-sans text-2xs font-medium tracking-wide',
        tone === 'dark' ? 'bg-white/14 text-white/80' : 'bg-inset text-fg-tertiary shadow-[inset_0_-1px_0_var(--ff-border)]',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
