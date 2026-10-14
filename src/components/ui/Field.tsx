import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cx } from './cx';

export function FieldRow({ label, children, hint, htmlFor }: { label: string; children: ReactNode; hint?: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-xs font-medium text-fg-secondary">
        {label}
      </label>
      {children}
      {hint && <div className="text-xs text-fg-tertiary">{hint}</div>}
    </div>
  );
}

export const inputClass =
  'h-7 w-full rounded-sm bg-elevated px-2 text-sm text-fg shadow-[inset_0_0_0_1px_var(--ff-border-strong)] placeholder:text-fg-tertiary transition-shadow duration-100 hover:shadow-[inset_0_0_0_1px_var(--ff-fg-tertiary)] focus:shadow-[inset_0_0_0_1.5px_var(--ff-accent),0_0_0_3px_var(--ff-accent-soft)] disabled:opacity-60';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(inputClass, className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <div className={cx('relative', className)}>
      <select ref={ref} className={cx(inputClass, 'appearance-none pr-7')} {...rest}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-fg-tertiary" />
    </div>
  );
});
