import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCheck, ChevronDown, RotateCcw } from 'lucide-react';
import { goToPage } from '@/app/commands';
import { acceptAllConfident, focusField, restoreField } from '@/app/fieldActions';
import { Button } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Segmented';
import { cx } from '@/components/ui/cx';
import { FIELD_KIND_LABELS, fieldStatus, isUncertain, summarizeFields, UNCERTAIN_THRESHOLD } from '@/model/fields';
import type { DocModel, FormField } from '@/model/types';
import type { PageGeometry } from '@/pdf/geometry';
import type { PDFDocumentProxy } from '@/pdf/pdfjs';
import { renderPageInto } from '@/pdf/render';
import { useEditor } from '@/state/editor';
import { useUi, ui } from '@/state/ui';
import { FIELD_KIND_ICONS } from './fieldIcons';
import { StatusDot } from './GuidedPanel';

const THUMB_WIDTH = 132;

export function Sidebar({ doc, pages }: { doc: PDFDocumentProxy; pages: PageGeometry[] }) {
  const panel = useUi((s) => s.leftPanel);
  const fieldCount = useEditor((s) => s.model.fieldOrder.length);
  return (
    <aside aria-label="Document navigation" className="flex w-[232px] shrink-0 flex-col border-r border-line bg-chrome max-[820px]:hidden" data-testid="sidebar">
      <div className="px-3 pb-2 pt-2.5">
        <Segmented
          ariaLabel="Sidebar view"
          className="w-full"
          size="sm"
          value={panel}
          onChange={(p) => ui().setLeftPanel(p)}
          options={[
            { value: 'pages', label: `Pages · ${pages.length}` },
            { value: 'fields', label: `Fields · ${fieldCount}` },
          ]}
        />
      </div>
      {panel === 'pages' ? <Thumbnails doc={doc} pages={pages} /> : <FieldsList />}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Thumbnails
// ---------------------------------------------------------------------------

function Thumbnails({ doc, pages }: { doc: PDFDocumentProxy; pages: PageGeometry[] }) {
  const current = useUi((s) => s.currentPage);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the current page's thumbnail in view as the workspace scrolls.
  useEffect(() => {
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-thumb="${current}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  return (
    <nav aria-label="Pages" ref={scrollRef} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-3 pb-4">
      <ol className="flex flex-col items-center gap-3 pt-1">
        {pages.map((g) => (
          <li key={g.index}>
            <Thumbnail doc={doc} geom={g} active={g.index === current} root={scrollRef} />
          </li>
        ))}
      </ol>
    </nav>
  );
}

const Thumbnail = memo(function Thumbnail({
  doc,
  geom,
  active,
  root,
}: {
  doc: PDFDocumentProxy;
  geom: PageGeometry;
  active: boolean;
  root: React.RefObject<HTMLDivElement | null>;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [rendered, setRendered] = useState(false);
  const scale = THUMB_WIDTH / geom.width;
  const height = Math.round(geom.height * scale);

  // Virtualization: only thumbnails near the visible area render a canvas.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(!!e?.isIntersecting), { root: root.current, rootMargin: '400px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [root]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let task: { cancel(): void; promise: Promise<void> } | null = null;
    void doc.getPage(geom.index + 1).then((page) => {
      if (cancelled || !canvasRef.current) return;
      task = renderPageInto(page, { canvas: canvasRef.current, scale, outputScale: Math.min(2, window.devicePixelRatio || 1) });
      task.promise.then(
        () => !cancelled && setRendered(true),
        () => {},
      );
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [visible, doc, geom.index, scale]);

  return (
    <button
      ref={ref}
      type="button"
      data-thumb={geom.index}
      aria-label={`Page ${geom.index + 1}`}
      aria-current={active ? 'page' : undefined}
      onClick={() => goToPage(geom.index)}
      className="group flex flex-col items-center gap-1.5 rounded-md outline-none"
    >
      <span
        className={cx(
          'relative block overflow-hidden rounded-[3px] bg-white shadow-[var(--ff-shadow-page)] transition-shadow duration-100',
          active ? 'shadow-[0_0_0_2px_var(--ff-accent)]' : 'group-hover:shadow-[0_0_0_2px_var(--ff-accent-border)]',
          'group-focus-visible:shadow-[var(--ff-focus-ring)]',
        )}
        style={{ width: THUMB_WIDTH, height }}
      >
        {visible && <canvas ref={canvasRef} className={cx('block size-full transition-opacity duration-200', rendered ? 'opacity-100' : 'opacity-0')} style={{ width: THUMB_WIDTH, height }} />}
      </span>
      <span className={cx('text-2xs tabular-nums', active ? 'font-semibold text-accent-fg' : 'text-fg-tertiary')}>{geom.index + 1}</span>
    </button>
  );
});

// ---------------------------------------------------------------------------
// Fields list
// ---------------------------------------------------------------------------

type Filter = 'all' | 'todo' | 'review';

function FieldsList() {
  const model = useEditor((s) => s.model);
  const activeId = useUi((s) => s.activeFieldId);
  const [filter, setFilter] = useState<Filter>('all');
  const [showDismissed, setShowDismissed] = useState(false);
  const summary = useMemo(() => summarizeFields(model), [model]);

  const { groups, dismissed, confidentSuggestions } = useMemo(() => groupFields(model, filter), [model, filter]);

  useEffect(() => {
    if (!activeId) return;
    document.querySelector(`[data-field-row="${activeId}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  if (model.fieldOrder.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-sm text-fg-secondary">
        <p className="font-medium text-fg">No fields found</p>
        <p className="mt-1 text-xs leading-relaxed">This page has no form fields or blank lines that look fillable. Use the toolbar to type, check or sign anywhere.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 px-3 pb-2">
        {(
          [
            ['all', 'All', summary.total],
            ['todo', 'To do', summary.remaining + summary.skipped],
            ['review', 'Unsure', summary.uncertain],
          ] as const
        ).map(([id, label, n]) => (
          <button
            key={id}
            type="button"
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
            className={cx(
              'h-6 rounded-sm px-2 text-xs font-medium',
              filter === id ? 'bg-active text-fg' : 'text-fg-secondary hover:bg-hover hover:text-fg',
            )}
          >
            {label} <span className="tabular-nums text-fg-tertiary">{n}</span>
          </button>
        ))}
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-1.5 pb-3" role="list" aria-label="Fields">
        {groups.length === 0 && <p className="px-2 py-4 text-center text-xs text-fg-tertiary">Nothing here.</p>}
        {groups.map(([page, fields]) => (
          <div key={page} role="group" aria-label={`Page ${page + 1}`}>
            <div className="sticky top-0 z-[1] bg-chrome px-2 pb-1 pt-2 text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">Page {page + 1}</div>
            {fields.map((f) => (
              <FieldRow key={f.id} field={f} model={model} active={f.id === activeId} />
            ))}
          </div>
        ))}

        {dismissed.length > 0 && filter === 'all' && (
          <div className="mt-2 border-t border-line-subtle pt-1">
            <button
              type="button"
              aria-expanded={showDismissed}
              onClick={() => setShowDismissed(!showDismissed)}
              className="flex h-7 w-full items-center gap-1 rounded-sm px-2 text-xs text-fg-tertiary hover:bg-hover hover:text-fg-secondary"
            >
              <ChevronDown className={cx('size-3.5 transition-transform', !showDismissed && '-rotate-90')} />
              Dismissed suggestions · {dismissed.length}
            </button>
            {showDismissed &&
              dismissed.map((f) => (
                <div key={f.id} className="flex h-7 items-center gap-2 px-2 text-xs text-fg-tertiary" role="listitem">
                  <span className="min-w-0 flex-1 truncate line-through" dir="auto">
                    {f.label ?? FIELD_KIND_LABELS[f.kind]}
                  </span>
                  <span>p{f.pageIndex + 1}</span>
                  <button type="button" onClick={() => restoreField(f.id)} className="rounded-xs p-0.5 hover:bg-hover hover:text-fg" aria-label={`Restore ${f.label ?? 'field'}`} title="Restore">
                    <RotateCcw className="size-3.5" />
                  </button>
                </div>
              ))}
          </div>
        )}
      </div>

      {confidentSuggestions > 0 && (
        <div className="border-t border-line px-3 py-2">
          <Button
            size="sm"
            variant="ghost"
            className="w-full"
            icon={<CheckCheck className="size-3.5" />}
            onClick={() => {
              const n = acceptAllConfident(UNCERTAIN_THRESHOLD);
              ui().flash(`Accepted ${n} suggested field${n === 1 ? '' : 's'}`);
            }}
          >
            Accept {confidentSuggestions} likely field{confidentSuggestions === 1 ? '' : 's'}
          </Button>
        </div>
      )}
    </div>
  );
}

function groupFields(m: DocModel, filter: Filter) {
  const byPage = new Map<number, FormField[]>();
  const dismissed: FormField[] = [];
  let confidentSuggestions = 0;
  for (const id of m.fieldOrder) {
    const f = m.fields[id];
    if (!f) continue;
    if (f.review === 'rejected') {
      dismissed.push(f);
      continue;
    }
    if (f.review === 'suggested' && f.confidence >= UNCERTAIN_THRESHOLD) confidentSuggestions++;
    const st = fieldStatus(m, f);
    if (filter === 'todo' && st !== 'empty' && st !== 'skipped') continue;
    if (filter === 'review' && (!isUncertain(f) || st === 'na')) continue;
    const list = byPage.get(f.pageIndex) ?? [];
    list.push(f);
    byPage.set(f.pageIndex, list);
  }
  return { groups: [...byPage.entries()].sort((a, b) => a[0] - b[0]), dismissed, confidentSuggestions };
}

const FieldRow = memo(function FieldRow({ field: f, model, active }: { field: FormField; model: DocModel; active: boolean }) {
  const st = fieldStatus(model, f);
  const uncertain = isUncertain(f) && st !== 'na';
  const Icon = FIELD_KIND_ICONS[f.kind];
  return (
    <button
      type="button"
      role="listitem"
      data-field-row={f.id}
      aria-current={active ? 'true' : undefined}
      onClick={() => focusField(f.id, { fill: false })}
      onDoubleClick={() => focusField(f.id, { fill: true })}
      className={cx(
        'flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-sm outline-none focus-visible:shadow-[var(--ff-focus-ring-inset)]',
        active ? 'bg-accent-soft text-fg' : 'text-fg-secondary hover:bg-hover hover:text-fg',
      )}
      title={`${FIELD_KIND_LABELS[f.kind]} · ${sourceLabel(f)}${f.review === 'suggested' ? ` · ${Math.round(f.confidence * 100)}% confidence` : ''}`}
    >
      <StatusDot status={st} />
      <Icon className="size-3.5 shrink-0 stroke-[1.75] text-fg-tertiary" aria-hidden />
      <span className={cx('min-w-0 flex-1 truncate', st === 'na' && 'line-through opacity-70', !f.label && 'italic text-fg-tertiary')} dir="auto">
        {f.label ?? `Unlabelled ${FIELD_KIND_LABELS[f.kind].toLowerCase()}`}
      </span>
      {uncertain && <span className="size-1.5 shrink-0 rounded-full bg-warning" aria-label="Possible field — please check" />}
    </button>
  );
});

export function sourceLabel(f: FormField): string {
  if (f.native) return 'PDF form field';
  if (f.sources.includes('manual')) return 'Added by you';
  const parts = [];
  if (f.sources.includes('text')) parts.push('text');
  if (f.sources.includes('visual')) parts.push('lines & boxes');
  return `Detected from ${parts.join(' + ') || 'layout'}`;
}
