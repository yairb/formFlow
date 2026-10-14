import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Handle } from '@/model/annotations';
import type { Rect } from '@/pdf/geometry';
import { cx } from '@/components/ui/cx';

const CURSORS: Record<Handle, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
};

function handlePosition(h: Handle, w: number, hgt: number): { left: number; top: number } {
  const left = h.includes('w') ? 0 : h.includes('e') ? w : w / 2;
  const top = h.includes('n') ? 0 : h.includes('s') ? hgt : hgt / 2;
  return { left, top };
}

/** Selection outline (screen space) with optional resize handles. */
export function SelectionFrame({
  rect,
  scale,
  handles,
  editing,
  onHandleDown,
}: {
  rect: Rect;
  scale: number;
  handles: Handle[];
  editing?: boolean;
  onHandleDown?: (h: Handle, e: ReactPointerEvent) => void;
}) {
  const pad = 3;
  const w = rect.width * scale + pad * 2;
  const h = rect.height * scale + pad * 2;
  return (
    <div
      className={cx(
        'pointer-events-none absolute rounded-[3px] border',
        editing ? 'border-dashed border-[var(--ff-doc-selection)]/80' : 'border-[var(--ff-doc-selection)]',
      )}
      style={{ left: rect.x * scale - pad, top: rect.y * scale - pad, width: w, height: h }}
      data-selection-frame
    >
      {handles.map((hd) => {
        const pos = handlePosition(hd, w, h);
        const bar = hd === 'e' || hd === 'w';
        return (
          <div
            key={hd}
            data-handle={hd}
            role="presentation"
            onPointerDown={(e) => onHandleDown?.(hd, e)}
            className={cx(
              'pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 border border-[var(--ff-doc-selection)] bg-white shadow-[0_1px_2px_rgb(0_0_0/0.2)]',
              bar ? 'h-3.5 w-[7px] rounded-full' : 'size-[9px] rounded-[2.5px]',
            )}
            style={{ ...pos, cursor: CURSORS[hd], touchAction: 'none' }}
          >
            <span className="absolute -inset-2" />
          </div>
        );
      })}
    </div>
  );
}
