import { CalendarDays, Check, Highlighter, MousePointer2, PenLine, Signature, Type, X, type LucideIcon } from 'lucide-react';
import { Fragment } from 'react';
import { setTool } from '@/app/commands';
import { Tooltip } from '@/components/ui/Tooltip';
import { Kbd } from '@/components/ui/Kbd';
import { cx } from '@/components/ui/cx';
import { useUi, type Tool } from '@/state/ui';
import { TOOL_KEYS } from './shortcuts';

const GROUPS: { tool: Tool; label: string; icon: LucideIcon; hint: string }[][] = [
  [{ tool: 'select', label: 'Select', icon: MousePointer2, hint: 'Select, move and resize' }],
  [
    { tool: 'text', label: 'Text', icon: Type, hint: 'Click to type anywhere' },
    { tool: 'check', label: 'Check', icon: Check, hint: 'Place a check mark' },
    { tool: 'cross', label: 'Cross', icon: X, hint: 'Place a cross mark' },
    { tool: 'date', label: 'Date', icon: CalendarDays, hint: 'Insert today’s date' },
  ],
  [
    { tool: 'signature', label: 'Signature', icon: Signature, hint: 'Place your signature' },
    { tool: 'draw', label: 'Draw', icon: PenLine, hint: 'Draw freehand' },
    { tool: 'highlight', label: 'Highlight', icon: Highlighter, hint: 'Drag to highlight' },
  ],
];

export function Toolbar() {
  const tool = useUi((s) => s.tool);
  return (
    <div
      role="toolbar"
      aria-label="Tools"
      aria-orientation="horizontal"
      className="pointer-events-auto flex items-center gap-0.5 rounded-lg bg-elevated p-1 shadow-md"
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (i < 0) return;
        e.preventDefault();
        buttons[(i + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      }}
    >
      {GROUPS.map((group, gi) => (
        <Fragment key={gi}>
          {gi > 0 && <span className="mx-1 h-5 w-px bg-line" aria-hidden />}
          {group.map(({ tool: t, label, icon: Icon, hint }) => {
            const active = tool === t;
            return (
              <Tooltip
                key={t}
                side="bottom"
                label={
                  <span className="flex flex-col">
                    <span>{label}</span>
                    <span className="font-normal text-white/60">{hint}</span>
                  </span>
                }
                shortcut={TOOL_KEYS[t]}
              >
                <button
                  type="button"
                  aria-label={label}
                  aria-pressed={active}
                  aria-keyshortcuts={TOOL_KEYS[t]}
                  data-tool={t}
                  tabIndex={active ? 0 : -1}
                  onClick={() => setTool(t)}
                  className={cx(
                    'relative inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-md px-2 text-sm font-medium transition-[background-color,color] duration-100 [&>svg]:size-[17px] [&>svg]:stroke-[1.75]',
                    active ? 'bg-accent text-fg-on-accent shadow-[inset_0_1px_0_rgb(255_255_255/0.14)]' : 'text-fg-secondary hover:bg-hover hover:text-fg',
                  )}
                >
                  <Icon />
                  {active && t !== 'select' && <span className="pr-0.5 max-[900px]:hidden">{label}</span>}
                </button>
              </Tooltip>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}

export function ToolHint() {
  const tool = useUi((s) => s.tool);
  const hint: Partial<Record<Tool, string>> = {
    text: 'Click on the page to add text. Click a form field to fill it.',
    check: 'Click to place a check. Clicking a checkbox toggles it.',
    cross: 'Click to place a cross.',
    date: 'Click to insert today’s date.',
    signature: 'Click where you want to sign.',
    draw: 'Draw with your mouse, trackpad or pen.',
    highlight: 'Drag over the area to highlight.',
  };
  const text = hint[tool];
  if (!text) return null;
  return (
    <div key={tool} className="ff-animate-fade pointer-events-none flex items-center gap-2 rounded-md bg-[#1c1c1f]/85 px-2.5 py-1 text-xs text-white/90 shadow-sm backdrop-blur dark:bg-[#3a3b40]/90">
      {text}
      <span className="text-white/50">
        <Kbd tone="dark">Esc</Kbd> to finish
      </span>
    </div>
  );
}
