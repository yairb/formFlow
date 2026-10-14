import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlignCenter, AlignLeft, AlignRight, Ban, Bold, Check, ClipboardCheck, Copy, ListChecks, Plus, SkipForward, Trash2, X } from 'lucide-react';
import { deleteSelection, duplicateSelection, updateSelected } from '@/app/editActions';
import {
  acceptField,
  clearField,
  deleteField,
  rejectField,
  setFieldKind,
  setFieldLabel,
  skipField,
  startGuided,
  toggleFieldChecked,
  toggleNotApplicable,
} from '@/app/fieldActions';
import { Button } from '@/components/ui/Button';
import { ColorSwatches, HIGHLIGHT_COLORS } from '@/components/ui/ColorSwatches';
import { FieldRow, Input, Select } from '@/components/ui/Field';
import { IconButton } from '@/components/ui/IconButton';
import { Segmented } from '@/components/ui/Segmented';
import { Slider } from '@/components/ui/Slider';
import { cx } from '@/components/ui/cx';
import { annotationLabel, fitTextAnnotation } from '@/model/annotations';
import { DATE_FORMATS, formatDate } from '@/model/dates';
import { FIELD_KIND_LABELS, fieldIsChecked, fieldStatus, fieldTextValue, isUncertain, layoutFieldText, setFieldText, summarizeFields } from '@/model/fields';
import type { Annotation, DateFormat, DocModel, FieldKind, FormField, MarkKind, TextAlign, TextAnnotation } from '@/model/types';
import { editor, useEditor } from '@/state/editor';
import { fillDefaults, usePrefs } from '@/state/prefs';
import { useSignatures } from '@/state/signatures';
import { ui, useUi, type Tool } from '@/state/ui';
import { FONT_FAMILIES, familySupportsBold, type DocFontFamily } from '@/text/fonts';
import { StatusPill } from './GuidedPanel';
import { sourceLabel } from './Sidebar';

const KIND_CHOICES: FieldKind[] = ['text', 'multiline', 'date', 'checkbox', 'radio', 'signature', 'drawing'];

export function Inspector() {
  const selection = useUi((s) => s.selection);
  const activeId = useUi((s) => s.activeFieldId);
  const tool = useUi((s) => s.tool);
  const model = useEditor((s) => s.model);
  const selected = selection.map((id) => model.annotations[id]).filter((a): a is Annotation => !!a);
  const field = activeId ? model.fields[activeId] : undefined;

  let body: ReactNode;
  if (selected.length > 0) body = <SelectionPanel items={selected} model={model} />;
  else if (field && field.review !== 'rejected') body = <FieldPanel field={field} model={model} />;
  else body = <DefaultPanel tool={tool} model={model} />;

  return (
    <aside aria-label="Properties" data-testid="inspector" className="scrollbar-thin flex w-[272px] shrink-0 flex-col overflow-y-auto border-l border-line bg-panel max-[1100px]:hidden">
      {body}
    </aside>
  );
}

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="border-b border-line-subtle px-4 py-3.5 last:border-b-0">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h2 className="text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">{title}</h2>
        {aside}
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Selected annotations
// ---------------------------------------------------------------------------

function SelectionPanel({ items, model }: { items: Annotation[]; model: DocModel }) {
  const first = items[0]!;
  const same = items.every((a) => a.type === first.type);
  const title = items.length === 1 ? annotationLabel(first) : `${items.length} items`;
  return (
    <>
      <Section
        title={title}
        aside={
          <div className="-mr-1.5 flex">
            <IconButton size="sm" label="Duplicate" onClick={duplicateSelection}>
              <Copy />
            </IconButton>
            <IconButton size="sm" label="Delete" onClick={deleteSelection}>
              <Trash2 />
            </IconButton>
          </div>
        }
      >
        {first.fieldId && items.length === 1 && model.fields[first.fieldId] && (
          <p className="text-xs text-fg-secondary">
            Value of <span className="font-medium text-fg">{model.fields[first.fieldId]!.label ?? 'a field'}</span>
          </p>
        )}
        {same && first.type === 'text' && <TextControls items={items as TextAnnotation[]} />}
        {same && first.type === 'mark' && <MarkControls mark={first.mark} color={first.color} />}
        {same && first.type === 'ink' && <InkControls color={first.color} width={first.strokeWidth} />}
        {same && first.type === 'highlight' && (
          <FieldRow label="Color">
            <ColorSwatches colors={HIGHLIGHT_COLORS} value={first.color} onChange={(color) => updateSelected('Change color', (a) => ({ ...a, color }) as Annotation)} />
          </FieldRow>
        )}
        {same && first.type === 'signature' && (
          <>
            <p className="text-xs leading-relaxed text-fg-secondary">A picture of your signature placed on the page. It is not a cryptographic digital signature. Resizing keeps its proportions.</p>
            <Button size="sm" onClick={() => ui().openDialog({ kind: 'signature' })}>
              Manage signatures…
            </Button>
          </>
        )}
      </Section>
      <Hints />
    </>
  );
}

function relayText(m: DocModel, a: TextAnnotation, patch: Partial<TextAnnotation>): TextAnnotation {
  const next = { ...a, ...patch };
  const field = a.fieldId ? m.fields[a.fieldId] : undefined;
  return field ? layoutFieldText(field, next) : fitTextAnnotation(next);
}

function TextControls({ items }: { items: TextAnnotation[] }) {
  const a = items[0]!;
  const update = (label: string, patch: Partial<TextAnnotation>, mergeKey?: string) =>
    updateSelected(label, (x) => (x.type === 'text' ? relayText(editor().model, x, patch) : null), mergeKey);
  const [size, setSize] = useState(a.fontSize);
  useEffect(() => setSize(a.fontSize), [a.fontSize]);
  const ids = items.map((x) => x.id).join(',');
  return (
    <>
      <FieldRow label="Font">
        <div className="flex items-center gap-2">
          <Segmented<DocFontFamily>
            ariaLabel="Font family"
            size="sm"
            className="flex-1"
            value={a.fontFamily}
            onChange={(fontFamily) => update('Change font', { fontFamily, bold: familySupportsBold(fontFamily) ? a.bold : false })}
            options={FONT_FAMILIES.map((f) => ({ value: f.id, label: f.label }))}
          />
          <IconButton
            label="Bold"
            size="sm"
            active={a.bold}
            disabled={!familySupportsBold(a.fontFamily)}
            onClick={() => update(a.bold ? 'Remove bold' : 'Bold', { bold: !a.bold })}
          >
            <Bold />
          </IconButton>
        </div>
      </FieldRow>
      <FieldRow label={`Size · ${size} pt`}>
        <Slider ariaLabel="Font size" min={6} max={36} step={0.5} value={size} onChange={(v) => {
          setSize(v);
          update('Change font size', { fontSize: v }, `size:${ids}`);
        }} />
      </FieldRow>
      <FieldRow label="Alignment">
        <Segmented<TextAlign>
          ariaLabel="Alignment"
          size="sm"
          value={a.align}
          onChange={(align) => update('Change alignment', { align })}
          options={[
            { value: 'left', label: 'Left', icon: <AlignLeft />, iconOnly: true },
            { value: 'center', label: 'Center', icon: <AlignCenter />, iconOnly: true },
            { value: 'right', label: 'Right', icon: <AlignRight />, iconOnly: true },
          ]}
        />
      </FieldRow>
      <FieldRow label="Color">
        <ColorSwatches value={a.color} onChange={(color) => update('Change color', { color })} />
      </FieldRow>
      {a.date && items.length === 1 && (
        <FieldRow label="Date format">
          <Select
            aria-label="Date format"
            value={a.date.format}
            onChange={(e) => {
              const format = e.target.value as DateFormat;
              update('Change date format', { date: { iso: a.date!.iso, format }, text: formatDate(a.date!.iso, format) });
            }}
          >
            {DATE_FORMATS.map((f) => (
              <option key={f.id} value={f.id}>
                {formatDate(a.date!.iso, f.id)}
              </option>
            ))}
          </Select>
          <Input
            type="date"
            aria-label="Date"
            value={a.date.iso}
            onChange={(e) => {
              const iso = e.target.value;
              if (iso) update('Change date', { date: { iso, format: a.date!.format }, text: formatDate(iso, a.date!.format) });
            }}
          />
        </FieldRow>
      )}
    </>
  );
}

function MarkControls({ mark, color }: { mark: MarkKind; color: string }) {
  return (
    <>
      <FieldRow label="Mark">
        <Segmented<MarkKind>
          ariaLabel="Mark"
          size="sm"
          value={mark}
          onChange={(m) => updateSelected('Change mark', (a) => (a.type === 'mark' ? { ...a, mark: m } : null))}
          options={[
            { value: 'check', label: 'Check', icon: <Check />, iconOnly: true },
            { value: 'cross', label: 'Cross', icon: <X />, iconOnly: true },
            { value: 'dot', label: 'Dot', icon: <span className="size-2 rounded-full bg-current" />, iconOnly: true },
          ]}
        />
      </FieldRow>
      <FieldRow label="Color">
        <ColorSwatches value={color} onChange={(c) => updateSelected('Change color', (a) => (a.type === 'mark' ? { ...a, color: c } : null))} />
      </FieldRow>
    </>
  );
}

function InkControls({ color, width }: { color: string; width: number }) {
  const [w, setW] = useState(width);
  useEffect(() => setW(width), [width]);
  return (
    <>
      <FieldRow label="Color">
        <ColorSwatches value={color} onChange={(c) => updateSelected('Change color', (a) => (a.type === 'ink' ? { ...a, color: c } : null))} />
      </FieldRow>
      <FieldRow label={`Thickness · ${w.toFixed(1)} pt`}>
        <Slider
          ariaLabel="Stroke thickness"
          min={0.5}
          max={6}
          step={0.1}
          value={w}
          onChange={(v) => {
            setW(v);
            updateSelected('Change thickness', (a) => (a.type === 'ink' ? { ...a, strokeWidth: v } : null), 'ink-width');
          }}
        />
      </FieldRow>
    </>
  );
}

// ---------------------------------------------------------------------------
// Active field
// ---------------------------------------------------------------------------

function FieldPanel({ field: f, model }: { field: FormField; model: DocModel }) {
  const status = fieldStatus(model, f);
  const readOnly = !!f.native?.readOnly;
  return (
    <>
      <Section title="Field" aside={<StatusPill status={status} />}>
        <LabelInput field={f} />
        <FieldRow label="Type" htmlFor="ff-field-kind">
          <Select id="ff-field-kind" value={f.kind} disabled={!!f.native} onChange={(e) => setFieldKind(f.id, e.target.value as FieldKind)}>
            {KIND_CHOICES.map((k) => (
              <option key={k} value={k}>
                {FIELD_KIND_LABELS[k]}
              </option>
            ))}
            {!KIND_CHOICES.includes(f.kind) && <option value={f.kind}>{FIELD_KIND_LABELS[f.kind]}</option>}
          </Select>
        </FieldRow>
        {!readOnly && !f.notApplicable && <ValueControl field={f} model={model} />}
        {readOnly && <p className="text-xs text-fg-secondary">This field is read-only in the PDF.</p>}
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="subtle" icon={<SkipForward className="size-3.5" />} disabled={status === 'filled' || f.skipped || readOnly} onClick={() => skipField(f.id)}>
            {f.skipped ? 'Skipped' : 'Skip'}
          </Button>
          <Button size="sm" variant="subtle" icon={<Ban className="size-3.5" />} aria-pressed={f.notApplicable} disabled={readOnly} onClick={() => toggleNotApplicable(f.id)}>
            {f.notApplicable ? 'Mark applicable' : 'Not applicable'}
          </Button>
          {status === 'filled' && (
            <Button size="sm" variant="ghost" onClick={() => clearField(f.id)}>
              Clear
            </Button>
          )}
        </div>
      </Section>
      <DetectionSection field={f} />
    </>
  );
}

function LabelInput({ field: f }: { field: FormField }) {
  const [value, setValue] = useState(f.label ?? '');
  useEffect(() => setValue(f.label ?? ''), [f.id, f.label]);
  return (
    <FieldRow label="Label" htmlFor="ff-field-label">
      <Input
        id="ff-field-label"
        dir="auto"
        value={value}
        placeholder="Unlabelled"
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => setFieldLabel(f.id, value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setValue(f.label ?? '');
        }}
      />
    </FieldRow>
  );
}

function ValueControl({ field: f, model }: { field: FormField; model: DocModel }) {
  if (f.kind === 'checkbox' || f.kind === 'radio') {
    const checked = fieldIsChecked(model, f.id);
    return (
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4 accent-[var(--ff-accent)]" checked={checked} onChange={() => toggleFieldChecked(f.id)} />
        {checked ? 'Checked' : 'Not checked'}
      </label>
    );
  }
  if (f.kind === 'text' || f.kind === 'multiline' || f.kind === 'date') return <TextValue field={f} model={model} />;
  if (f.kind === 'signature' || f.kind === 'drawing') {
    return (
      <Button size="sm" onClick={() => ui().openDialog({ kind: 'signature', place: { pageIndex: f.pageIndex, at: { x: f.rect.x + f.rect.width / 2, y: f.rect.y + f.rect.height / 2 }, fieldId: f.id } })}>
        {fieldStatus(model, f) === 'filled' ? 'Replace signature…' : 'Add signature…'}
      </Button>
    );
  }
  return null;
}

function TextValue({ field: f, model }: { field: FormField; model: DocModel }) {
  const current = fieldTextValue(model, f.id);
  const [value, setValue] = useState(current);
  useEffect(() => setValue(current), [current, f.id]);
  const apply = (text: string) => {
    setValue(text);
    editor().commit('Fill field', (m) => setFieldText(m, m.fields[f.id] ?? f, text, fillDefaults()), { mergeKey: `field:${f.id}` });
  };
  const Tag = f.kind === 'multiline' ? 'textarea' : 'input';
  return (
    <FieldRow label="Value" htmlFor="ff-field-value">
      <Tag
        id="ff-field-value"
        dir="auto"
        value={value}
        rows={f.kind === 'multiline' ? 3 : undefined}
        onChange={(e) => apply(e.target.value)}
        className={cx(
          'w-full rounded-sm bg-elevated px-2 text-sm text-fg shadow-[inset_0_0_0_1px_var(--ff-border-strong)] focus:shadow-[inset_0_0_0_1.5px_var(--ff-accent),0_0_0_3px_var(--ff-accent-soft)]',
          f.kind === 'multiline' ? 'resize-y py-1.5' : 'h-7',
        )}
      />
    </FieldRow>
  );
}

function DetectionSection({ field: f }: { field: FormField }) {
  const uncertain = isUncertain(f);
  const detected = !f.native && !f.sources.includes('manual');
  const pct = Math.round(f.confidence * 100);
  return (
    <Section title="Detection">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
        <dt className="text-fg-tertiary">Source</dt>
        <dd className="text-fg-secondary">{sourceLabel(f)}</dd>
        {detected && (
          <>
            <dt className="text-fg-tertiary">Confidence</dt>
            <dd className="flex items-center gap-2">
              <span className="h-1 flex-1 overflow-hidden rounded-full bg-active" aria-hidden>
                <span className={cx('block h-full', uncertain ? 'bg-warning' : 'bg-success')} style={{ width: `${pct}%` }} />
              </span>
              <span className="tabular-nums text-fg-secondary">{pct}%</span>
            </dd>
            <dt className="text-fg-tertiary">Review</dt>
            <dd className="text-fg-secondary">{f.review === 'accepted' ? 'Accepted' : 'Suggested'}</dd>
          </>
        )}
      </dl>
      {detected && f.signals.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-xs text-fg-secondary" aria-label="Why this was detected">
          {f.signals.map((s) => (
            <li key={s} className="flex gap-1.5" dir="auto">
              <span className="text-fg-tertiary" aria-hidden>
                ·
              </span>
              {s}
            </li>
          ))}
        </ul>
      )}
      {detected && uncertain && (
        <p className="rounded-sm bg-warning-soft px-2 py-1.5 text-xs leading-relaxed text-fg">
          FormFlow isn’t sure this is a place to fill in. Keep it if it is, or dismiss it.
        </p>
      )}
      {detected && (
        <div className="flex gap-1.5">
          {f.review !== 'accepted' && (
            <Button size="sm" variant="subtle" icon={<Check className="size-3.5" />} onClick={() => acceptField(f.id)}>
              Keep field
            </Button>
          )}
          <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} onClick={() => rejectField(f.id)}>
            Dismiss
          </Button>
        </div>
      )}
      {f.sources.includes('manual') && (
        <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => deleteField(f.id)}>
          Remove field
        </Button>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Nothing selected: tool defaults and the document summary
// ---------------------------------------------------------------------------

function DefaultPanel({ tool, model }: { tool: Tool; model: DocModel }) {
  const summary = useMemo(() => summarizeFields(model), [model]);
  return (
    <>
      <Section title="Document">
        {summary.total > 0 ? (
          <>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat n={summary.filled} label="Filled" />
              <Stat n={summary.remaining + summary.skipped} label="To do" />
              <Stat n={summary.uncertain} label="Unsure" tone={summary.uncertain ? 'warning' : undefined} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Button variant="primary" icon={<ListChecks className="size-3.5" />} onClick={startGuided}>
                {summary.filled + summary.na > 0 ? 'Continue filling' : 'Start guided filling'}
              </Button>
              <Button icon={<ClipboardCheck className="size-3.5" />} onClick={() => ui().openDialog({ kind: 'review' })}>
                Review before export
              </Button>
            </div>
          </>
        ) : (
          <p className="text-xs leading-relaxed text-fg-secondary">No form fields were found. Pick a tool and click anywhere on the page to add text, marks, dates or a signature.</p>
        )}
      </Section>
      <ToolDefaults tool={tool} />
      <Hints />
    </>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone?: 'warning' }) {
  return (
    <div className="rounded-sm bg-inset px-1 py-1.5">
      <div className={cx('text-lg font-semibold tabular-nums', tone === 'warning' ? 'text-warning' : 'text-fg')}>{n}</div>
      <div className="text-2xs text-fg-tertiary">{label}</div>
    </div>
  );
}

function ToolDefaults({ tool }: { tool: Tool }) {
  const p = usePrefs();
  const sigs = useSignatures((s) => s.items);
  if (tool === 'text' || tool === 'date' || tool === 'select') {
    return (
      <Section title={tool === 'date' ? 'New dates' : 'New text'}>
        <FieldRow label="Font">
          <Segmented<DocFontFamily> ariaLabel="Default font" size="sm" value={p.fontFamily} onChange={(fontFamily) => p.set({ fontFamily })} options={FONT_FAMILIES.map((f) => ({ value: f.id, label: f.label }))} />
        </FieldRow>
        <FieldRow label={`Size · ${p.fontSize} pt`}>
          <Slider ariaLabel="Default font size" min={6} max={36} step={0.5} value={p.fontSize} onChange={(fontSize) => p.set({ fontSize })} />
        </FieldRow>
        <FieldRow label="Color">
          <ColorSwatches value={p.textColor} onChange={(textColor) => p.set({ textColor })} />
        </FieldRow>
        {tool === 'date' && (
          <FieldRow label="Date format" htmlFor="ff-default-date">
            <Select id="ff-default-date" value={p.dateFormat} onChange={(e) => p.set({ dateFormat: e.target.value as DateFormat })}>
              {DATE_FORMATS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.example}
                </option>
              ))}
            </Select>
          </FieldRow>
        )}
      </Section>
    );
  }
  if (tool === 'check' || tool === 'cross') {
    return (
      <Section title="New marks">
        <FieldRow label="Color">
          <ColorSwatches value={p.markColor} onChange={(markColor) => p.set({ markColor })} />
        </FieldRow>
      </Section>
    );
  }
  if (tool === 'draw') {
    return (
      <Section title="Pen">
        <FieldRow label="Color">
          <ColorSwatches value={p.inkColor} onChange={(inkColor) => p.set({ inkColor })} />
        </FieldRow>
        <FieldRow label={`Thickness · ${p.inkWidth.toFixed(1)} pt`}>
          <Slider ariaLabel="Pen thickness" min={0.5} max={6} step={0.1} value={p.inkWidth} onChange={(inkWidth) => p.set({ inkWidth })} />
        </FieldRow>
      </Section>
    );
  }
  if (tool === 'highlight') {
    return (
      <Section title="Highlighter">
        <FieldRow label="Color">
          <ColorSwatches colors={HIGHLIGHT_COLORS} value={p.highlightColor} onChange={(highlightColor) => p.set({ highlightColor })} />
        </FieldRow>
      </Section>
    );
  }
  return (
    <Section title="Signature">
      <p className="text-xs leading-relaxed text-fg-secondary">
        {sigs.length ? 'Click on the page to place your signature.' : 'Create a signature first — draw it, type it, or use an image.'}
      </p>
      <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => ui().openDialog({ kind: 'signature' })}>
        {sigs.length ? 'Manage signatures…' : 'Create signature…'}
      </Button>
    </Section>
  );
}

function Hints() {
  return (
    <div className="mt-auto px-4 py-3 text-2xs leading-relaxed text-fg-tertiary">
      Everything stays on this device. Your original PDF is never changed — Export creates a new file.
    </div>
  );
}
