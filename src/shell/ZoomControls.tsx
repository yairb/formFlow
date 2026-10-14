import { ChevronDown, Minus, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fit, goToPage, scalePercent, zoomBy, zoomTo } from '@/app/commands';
import { IconButton } from '@/components/ui/IconButton';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/Menu';
import { useUi } from '@/state/ui';
import { shortcutLabel } from './shortcuts';

export function ZoomControls({ pageCount }: { pageCount: number }) {
  const scale = useUi((s) => s.scale);
  const mode = useUi((s) => s.zoomMode);
  const current = useUi((s) => s.currentPage);

  return (
    <div className="pointer-events-auto flex items-center gap-0.5 rounded-lg bg-elevated p-1 text-sm shadow-md">
      <PageInput current={current} count={pageCount} />
      <span className="mx-1 h-5 w-px bg-line" aria-hidden />
      <IconButton label="Zoom out" shortcut={shortcutLabel('mod+-')} onClick={() => zoomBy(-1)} tooltipSide="top">
        <Minus />
      </IconButton>
      <Menu>
        <MenuTrigger asChild>
          <button
            type="button"
            aria-label={`Zoom ${scalePercent(scale)}%`}
            className="tabular inline-flex h-7 min-w-[64px] items-center justify-center gap-0.5 rounded-sm px-1.5 font-medium text-fg hover:bg-hover"
          >
            {mode === 'fit-width' ? 'Fit width' : mode === 'fit-page' ? 'Fit page' : `${scalePercent(scale)}%`}
            <ChevronDown className="size-3 text-fg-tertiary" />
          </button>
        </MenuTrigger>
        <MenuContent align="center">
          <MenuItem shortcut={shortcutLabel('mod+8')} onSelect={() => fit('fit-width')}>
            Fit width
          </MenuItem>
          <MenuItem shortcut={shortcutLabel('mod+9')} onSelect={() => fit('fit-page')}>
            Fit page
          </MenuItem>
          <MenuSeparator />
          {[50, 75, 100, 125, 150, 200, 300].map((p) => (
            <MenuItem key={p} shortcut={p === 100 ? shortcutLabel('mod+0') : undefined} onSelect={() => zoomTo(p)}>
              {p}%
            </MenuItem>
          ))}
        </MenuContent>
      </Menu>
      <IconButton label="Zoom in" shortcut={shortcutLabel('mod+=')} onClick={() => zoomBy(1)} tooltipSide="top">
        <Plus />
      </IconButton>
    </div>
  );
}

function PageInput({ current, count }: { current: number; count: number }) {
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => setDraft(null), [current]);
  return (
    <label className="tabular flex items-center gap-1 pl-1.5 pr-1 text-fg-secondary">
      <span className="sr-only">Page</span>
      <input
        value={draft ?? String(current + 1)}
        inputMode="numeric"
        aria-label={`Page ${current + 1} of ${count}`}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))}
        onBlur={() => setDraft(null)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const n = Number(draft);
            if (n >= 1) goToPage(n - 1);
            setDraft(null);
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            setDraft(null);
            e.currentTarget.blur();
          }
        }}
        className="h-6 w-8 rounded-xs bg-inset text-center font-medium text-fg outline-none focus:shadow-[var(--ff-focus-ring-inset)]"
        style={{ width: `${Math.max(2, String(count).length) + 1.5}ch` }}
      />
      <span>/ {count}</span>
    </label>
  );
}
