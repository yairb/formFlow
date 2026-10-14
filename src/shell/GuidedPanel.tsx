import { useEffect, useMemo } from 'react';
import { Ban, Check, ChevronLeft, ChevronRight, CircleDashed, CalendarCheck, ClipboardCheck, List, Shapes, SkipForward, X } from 'lucide-react';
import { afterFieldEnter, fillToday, focusField, setFieldKind, skipField, stepGuided, stopGuided, toggleNotApplicable, startFilling } from '@/app/fieldActions';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Kbd } from '@/components/ui/Kbd';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from '@/components/ui/Menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover';
import { cx } from '@/components/ui/cx';
import { fieldPosition, navigationList } from '@/guided/navigation';
import { FIELD_KIND_LABELS, fieldStatus, isUncertain, summarizeFields } from '@/model/fields';
import type { DocModel, FieldKind, FieldStatus, FormField } from '@/model/types';
import { useEditor } from '@/state/editor';
import { useFeedback } from '@/state/feedback';
import { ui, useUi } from '@/state/ui';
import { FIELD_KIND_ICONS } from './fieldIcons';

const KIND_CHOICES: FieldKind[] = ['text', 'multiline', 'date', 'checkbox', 'signature', 'drawing'];

/** Enter in a single-line field's text box moves on to the next field. */
function useFieldEnter() {
  useEffect(() => {
    const onNext = (e: Event) => afterFieldEnter((e as CustomEvent<string>).detail);
    window.addEventListener('ff:field-next', onNext);
    return () => window.removeEventListener('ff:field-next', onNext);
  }, []);
}

/** In guided mode, Enter (outside inputs) fills the current field or moves on. */
function useGuidedKeys(guided: boolean, field: FormField | null, status: FieldStatus | null) {
  useEffect(() => {
    if (!guided) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.key !== 'Enter' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, select, button, [role="dialog"], [role="menu"]') || t.isContentEditable)) return;
      if (useFeedback.getState().modal || ui().dialog || ui().editing) return;
      e.preventDefault();
      if (field && status === 'empty' && !e.shiftKey && (field.kind === 'text' || field.kind === 'multiline' || field.kind === 'date' || field.kind === 'signature')) startFilling(field);
      else stepGuided(e.shiftKey ? -1 : 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [guided, field, status]);
}

export function GuidedPanel() {
  const guided = useUi((s) => s.guided);
  const activeId = useUi((s) => s.activeFieldId);
  const model = useEditor((s) => s.model);
  const field = guided && activeId ? (model.fields[activeId] ?? null) : null;
  const status = field ? fieldStatus(model, field) : null;
  useFieldEnter();
  useGuidedKeys(guided, field, status);
  const summary = useMemo(() => summarizeFields(model), [model]);
  if (!guided) return null;

  const { index, total } = fieldPosition(model, activeId);
  const done = summary.filled + summary.na;
  const allDone = summary.remaining === 0 && summary.skipped === 0;

  return (
    <section
      aria-label="Guided filling"
      data-testid="guided-panel"
      className="ff-animate-pop pointer-events-auto w-[min(640px,calc(100%-24px))] overflow-hidden rounded-lg bg-elevated shadow-lg"
    >
      <div className="h-[3px] bg-inset" aria-hidden>
        <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </div>
      <div className="flex items-center gap-2 px-2.5 py-2">
        <IconButton label="Previous field" shortcut="⇧ Enter" onClick={() => stepGuided(-1)} disabled={total === 0}>
          <ChevronLeft />
        </IconButton>

        <div className="min-w-0 flex-1" aria-live="polite">
          {field ? (
            <>
              <div className="flex items-center gap-1.5 text-2xs font-medium uppercase tracking-[0.06em] text-fg-tertiary">
                <span className="tabular-nums" data-testid="guided-position">
                  Field {index + 1} of {total}
                </span>
                <span aria-hidden>·</span>
                <span>Page {field.pageIndex + 1}</span>
                <StatusPill status={status!} />
                {isUncertain(field) && status !== 'na' && (
                  <span className="rounded-xs bg-warning-soft px-1 py-px normal-case tracking-normal text-warning" title="FormFlow isn’t sure this is a field">
                    Possible field
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
                <KindIcon kind={field.kind} />
                <span className="truncate text-md font-medium text-fg" dir="auto" title={field.label ?? undefined}>
                  {field.label ?? `Unlabelled ${FIELD_KIND_LABELS[field.kind].toLowerCase()}`}
                </span>
              </div>
            </>
          ) : (
            <div className="text-sm text-fg-secondary">
              {total === 0 ? 'No fields to fill. Use the tools to add text and marks anywhere.' : `${done} of ${total} fields complete`}
            </div>
          )}
        </div>

        {field && (
          <div className="flex items-center gap-0.5">
            {field.kind === 'date' && status === 'empty' && !field.native?.readOnly && (
              <Button variant="ghost" size="sm" icon={<CalendarCheck className="size-3.5" />} onClick={() => fillToday(field.id)}>
                Today
              </Button>
            )}
            <Button variant="ghost" size="sm" icon={<SkipForward className="size-3.5" />} onClick={() => skipField(field.id)} disabled={status === 'filled'}>
              Skip
            </Button>
            <Button variant="ghost" size="sm" icon={<Ban className="size-3.5" />} aria-pressed={field.notApplicable} onClick={() => toggleNotApplicable(field.id)} disabled={!!field.native?.readOnly}>
              {field.notApplicable ? 'Applicable' : 'N/A'}
            </Button>
            <Menu>
              <MenuTrigger asChild>
                <IconButton label="Change field type" disabled={!!field.native}>
                  <Shapes />
                </IconButton>
              </MenuTrigger>
              <MenuContent align="end">
                <MenuLabel>Field type</MenuLabel>
                {KIND_CHOICES.map((k) => (
                  <MenuItem key={k} icon={<KindIcon kind={k} bare />} onSelect={() => setFieldKind(field.id, k)} shortcut={k === field.kind ? '✓' : undefined}>
                    {FIELD_KIND_LABELS[k]}
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
          </div>
        )}
        <Overview model={model} activeId={activeId} />
        <span className="mx-0.5 h-5 w-px bg-line" aria-hidden />

        {allDone ? (
          <Button variant="primary" icon={<ClipboardCheck className="size-3.5" />} onClick={() => ui().openDialog({ kind: 'review' })}>
            Review
          </Button>
        ) : (
          <Button variant="primary" trailing={<ChevronRight className="-mr-1 size-4" />} onClick={() => stepGuided(1)} disabled={total === 0}>
            Next
          </Button>
        )}
        <IconButton label="Exit guided filling" shortcut="Esc" onClick={stopGuided}>
          <X />
        </IconButton>
      </div>
      <div className="flex items-center justify-between border-t border-line-subtle px-3.5 py-1 text-2xs text-fg-tertiary">
        <span className="tabular-nums">
          {summary.filled} filled · {summary.remaining} empty{summary.skipped ? ` · ${summary.skipped} skipped` : ''}
          {summary.na ? ` · ${summary.na} not applicable` : ''}
        </span>
        <span className="flex items-center gap-1 max-[560px]:hidden">
          <Kbd>Enter</Kbd> next <Kbd>⇧ Enter</Kbd> back
        </span>
      </div>
    </section>
  );
}

function KindIcon({ kind, bare }: { kind: FieldKind; bare?: boolean }) {
  const Icon = FIELD_KIND_ICONS[kind];
  return <Icon className={cx(bare ? '' : 'size-4 shrink-0 stroke-[1.75] text-fg-tertiary')} aria-hidden />;
}

const STATUS_STYLE: Record<FieldStatus, { label: string; className: string }> = {
  empty: { label: 'Empty', className: 'bg-inset text-fg-secondary' },
  filled: { label: 'Filled', className: 'bg-success-soft text-success' },
  skipped: { label: 'Skipped', className: 'bg-inset text-fg-secondary' },
  na: { label: 'N/A', className: 'bg-inset text-fg-tertiary' },
};

export function StatusPill({ status }: { status: FieldStatus }) {
  const s = STATUS_STYLE[status];
  return <span className={cx('rounded-xs px-1 py-px normal-case tracking-normal', s.className)}>{s.label}</span>;
}

export function StatusDot({ status }: { status: FieldStatus }) {
  if (status === 'filled') return <Check className="size-3.5 shrink-0 text-success" strokeWidth={2.5} aria-label="Filled" />;
  if (status === 'na') return <Ban className="size-3.5 shrink-0 text-fg-tertiary" aria-label="Not applicable" />;
  if (status === 'skipped') return <SkipForward className="size-3.5 shrink-0 text-fg-tertiary" aria-label="Skipped" />;
  return <CircleDashed className="size-3.5 shrink-0 text-fg-tertiary" aria-label="Empty" />;
}

function Overview({ model, activeId }: { model: DocModel; activeId: string | null }) {
  const list = navigationList(model);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton label="All fields">
          <List />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-[300px] p-1">
        <div className="px-2 pb-1 pt-1.5 text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">All fields</div>
        <ol className="scrollbar-thin max-h-[320px] overflow-y-auto" aria-label="Fields">
          {list.map((f, i) => {
            const st = fieldStatus(model, f);
            return (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => focusField(f.id, { fill: true })}
                  aria-current={f.id === activeId ? 'step' : undefined}
                  className={cx(
                    'flex h-7 w-full items-center gap-2 rounded-sm px-2 text-left text-sm hover:bg-hover',
                    f.id === activeId && 'bg-accent-softer text-fg',
                  )}
                >
                  <span className="w-5 shrink-0 text-right text-2xs tabular-nums text-fg-tertiary">{i + 1}</span>
                  <StatusDot status={st} />
                  <span className={cx('min-w-0 flex-1 truncate', st === 'na' && 'text-fg-tertiary line-through')} dir="auto">
                    {f.label ?? FIELD_KIND_LABELS[f.kind]}
                  </span>
                  <span className="text-2xs text-fg-tertiary">p{f.pageIndex + 1}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </PopoverContent>
    </Popover>
  );
}
