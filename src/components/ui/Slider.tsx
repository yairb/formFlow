import * as RS from '@radix-ui/react-slider';

export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  onCommit,
  ariaLabel,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange(v: number): void;
  onCommit?(v: number): void;
  ariaLabel: string;
}) {
  return (
    <RS.Root
      value={[value]}
      min={min}
      max={max}
      step={step}
      onValueChange={([v]) => v !== undefined && onChange(v)}
      onValueCommit={([v]) => v !== undefined && onCommit?.(v)}
      className="relative flex h-5 w-full touch-none select-none items-center"
    >
      <RS.Track className="relative h-[3px] grow overflow-hidden rounded-full bg-active">
        <RS.Range className="absolute h-full bg-accent" />
      </RS.Track>
      <RS.Thumb
        aria-label={ariaLabel}
        className="block size-3.5 rounded-full bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.14),0_1px_3px_rgb(0_0_0/0.2)] transition-transform duration-100 hover:scale-110 focus-visible:shadow-focus"
      />
    </RS.Root>
  );
}
