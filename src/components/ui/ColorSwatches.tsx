import { Check } from 'lucide-react';
import { cx } from './cx';

export const INK_COLORS = [
  { value: '#111827', label: 'Black' },
  { value: '#1d2a6b', label: 'Navy' },
  { value: '#2453c9', label: 'Blue' },
  { value: '#b42318', label: 'Red' },
  { value: '#17803d', label: 'Green' },
];

export const HIGHLIGHT_COLORS = [
  { value: '#ffd94a', label: 'Yellow' },
  { value: '#7ee2a8', label: 'Green' },
  { value: '#8ccfff', label: 'Blue' },
  { value: '#ffa3c7', label: 'Pink' },
];

export function ColorSwatches({
  value,
  onChange,
  colors = INK_COLORS,
  ariaLabel = 'Color',
}: {
  value: string;
  onChange(c: string): void;
  colors?: { value: string; label: string }[];
  ariaLabel?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex items-center gap-1.5">
      {colors.map((c) => {
        const on = c.value.toLowerCase() === value.toLowerCase();
        return (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={c.label}
            title={c.label}
            onClick={() => onChange(c.value)}
            className={cx(
              'relative inline-flex size-[22px] items-center justify-center rounded-full transition-transform duration-100 hover:scale-110',
              on && 'shadow-[0_0_0_2px_var(--ff-bg-panel),0_0_0_3.5px_var(--ff-accent)]',
            )}
            style={{ background: c.value, boxShadow: on ? undefined : 'inset 0 0 0 1px rgb(0 0 0 / 0.12)' }}
          >
            {on && <Check className="size-3 text-white drop-shadow-[0_0_1px_rgb(0_0_0/0.5)]" strokeWidth={3} />}
          </button>
        );
      })}
    </div>
  );
}
