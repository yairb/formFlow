import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { AlertTriangle, CircleCheck, Eraser, ImageUp, PenLine, ShieldCheck, Trash2, Type } from 'lucide-react';
import { exportDocument } from '@/app/documentActions';
import { placeSignature } from '@/app/editActions';
import { focusField } from '@/app/fieldActions';
import { clearLocalData } from '@/app/sessions';
import { BRAND } from '@/brand';
import { Button } from '@/components/ui/Button';
import { ColorSwatches, INK_COLORS } from '@/components/ui/ColorSwatches';
import { Dialog } from '@/components/ui/Dialog';
import { FieldRow, Input, Select } from '@/components/ui/Field';
import { Kbd } from '@/components/ui/Kbd';
import { Segmented } from '@/components/ui/Segmented';
import { cx } from '@/components/ui/cx';
import { DATE_FORMATS } from '@/model/dates';
import { FIELD_KIND_LABELS, fieldStatus, isUncertain, setFieldSignature, summarizeFields } from '@/model/fields';
import type { DateFormat, FormField, SignatureImage } from '@/model/types';
import { canvasToSignature, imageFileToSignature, SIGNATURE_FONTS, typedSignature, type SignatureFontId } from '@/signature/image';
import { navigationList } from '@/guided/navigation';
import { editor, useEditor } from '@/state/editor';
import { confirm, toast } from '@/state/feedback';
import { usePrefs, type ThemePref } from '@/state/prefs';
import { signatures, useSignatures, type SavedSignature } from '@/state/signatures';
import { ui, useUi, type DialogRequest } from '@/state/ui';
import { TOOL_KEYS, shortcutLabel } from './shortcuts';

export function Dialogs() {
  const dialog = useUi((s) => s.dialog);
  const close = () => ui().openDialog(null);
  return (
    <>
      <SignatureDialog request={dialog?.kind === 'signature' ? dialog : null} onClose={close} />
      <ReviewDialog open={dialog?.kind === 'review'} onClose={close} />
      <SettingsDialog open={dialog?.kind === 'settings'} onClose={close} />
      <ShortcutsDialog open={dialog?.kind === 'shortcuts'} onClose={close} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Signature
// ---------------------------------------------------------------------------

type SigMode = 'draw' | 'type' | 'image';

function applySignature(req: Extract<DialogRequest, { kind: 'signature' }>, sig: SavedSignature): void {
  const place = req.place;
  if (!place) return;
  const field = place.fieldId ? editor().model.fields[place.fieldId] : undefined;
  if (field) {
    editor().commit('Sign', (m) => setFieldSignature(m, m.fields[field.id] ?? field, sig.image, sig.id));
    ui().setActiveField(field.id);
  } else {
    placeSignature(place.pageIndex, place.at);
  }
}

function SignatureDialog({ request, onClose }: { request: Extract<DialogRequest, { kind: 'signature' }> | null; onClose(): void }) {
  const saved = useSignatures((s) => s.items);
  const activeId = useSignatures((s) => s.activeId);
  const [mode, setMode] = useState<SigMode>('draw');
  const [creating, setCreating] = useState(false);
  const [remember, setRemember] = useState(false);
  const [pending, setPending] = useState<{ image: SignatureImage; source: SigMode } | null>(null);
  const placing = !!request?.place;

  useEffect(() => {
    if (!request) return;
    void signatures().load();
    setPending(null);
    setCreating(signatures().items.length === 0);
  }, [request]);

  const chooseSaved = (sig: SavedSignature) => {
    signatures().setActive(sig.id);
    if (request) applySignature(request, sig);
    onClose();
  };

  const save = () => {
    if (!pending || !request) return;
    const sig = signatures().add(pending.image, pending.source, remember);
    applySignature(request, sig);
    onClose();
  };

  return (
    <Dialog
      open={!!request}
      onOpenChange={(o) => !o && onClose()}
      width={520}
      title={creating ? 'Create your signature' : placing ? 'Choose a signature' : 'Signatures'}
      description="An image of your signature placed on the page. This is not a cryptographic digital signature."
      footer={
        creating ? (
          <>
            <label className="mr-auto flex items-center gap-2 text-xs text-fg-secondary">
              <input type="checkbox" className="size-3.5 accent-[var(--ff-accent)]" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Remember on this device
            </label>
            {saved.length > 0 && <Button onClick={() => setCreating(false)}>Back</Button>}
            <Button variant="primary" disabled={!pending} onClick={save}>
              {placing ? 'Sign' : 'Save'}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>Done</Button>
        )
      }
    >
      {creating ? (
        <div className="flex flex-col gap-3">
          <Segmented<SigMode>
            ariaLabel="Signature method"
            value={mode}
            onChange={(m) => {
              setMode(m);
              setPending(null);
            }}
            options={[
              { value: 'draw', label: 'Draw', icon: <PenLine /> },
              { value: 'type', label: 'Type', icon: <Type /> },
              { value: 'image', label: 'Image', icon: <ImageUp /> },
            ]}
          />
          {mode === 'draw' && <DrawPad onChange={(image) => setPending(image ? { image, source: 'draw' } : null)} />}
          {mode === 'type' && <TypePad onChange={(image) => setPending(image ? { image, source: 'type' } : null)} />}
          {mode === 'image' && <ImagePad onChange={(image) => setPending(image ? { image, source: 'image' } : null)} />}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <ul className="grid grid-cols-2 gap-2" aria-label="Saved signatures">
            {saved.map((s) => (
              <li key={s.id} className="group relative">
                <button
                  type="button"
                  onClick={() => chooseSaved(s)}
                  aria-label={`Use signature${s.id === activeId ? ' (current)' : ''}`}
                  className={cx(
                    'flex h-[84px] w-full items-center justify-center rounded-md bg-white p-3 shadow-[inset_0_0_0_1px_var(--ff-border)] hover:shadow-[inset_0_0_0_1.5px_var(--ff-accent)]',
                    s.id === activeId && 'shadow-[inset_0_0_0_1.5px_var(--ff-accent-border)]',
                  )}
                >
                  <img src={s.image.dataUrl} alt="" className="max-h-full max-w-full object-contain" draggable={false} />
                </button>
                <button
                  type="button"
                  aria-label="Delete signature"
                  onClick={() => signatures().remove(s.id)}
                  className="absolute right-1.5 top-1.5 rounded-xs bg-elevated/90 p-1 text-fg-tertiary opacity-0 shadow-sm hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
                <span className="mt-1 block text-2xs text-fg-tertiary">{s.remembered ? 'Saved on this device' : 'This session only'}</span>
              </li>
            ))}
          </ul>
          <Button className="self-start" onClick={() => setCreating(true)}>
            New signature…
          </Button>
        </div>
      )}
    </Dialog>
  );
}

function DrawPad({ onChange }: { onChange(image: SignatureImage | null): void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<[number, number][][]>([]);
  const drawing = useRef(false);
  const [color, setColor] = useState(INK_COLORS[1]!.value);
  const [empty, setEmpty] = useState(true);

  const redraw = () => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (c.width !== Math.round(w * dpr)) c.width = Math.round(w * dpr);
    if (c.height !== Math.round(h * dpr)) c.height = Math.round(h * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of strokes.current) {
      if (s.length === 0) continue;
      ctx.beginPath();
      ctx.moveTo(s[0]![0], s[0]![1]);
      if (s.length === 1) ctx.lineTo(s[0]![0] + 0.1, s[0]![1]);
      for (let i = 1; i < s.length - 1; i++) {
        const mx = (s[i]![0] + s[i + 1]![0]) / 2;
        const my = (s[i]![1] + s[i + 1]![1]) / 2;
        ctx.quadraticCurveTo(s[i]![0], s[i]![1], mx, my);
      }
      if (s.length > 1) ctx.lineTo(s[s.length - 1]![0], s[s.length - 1]![1]);
      ctx.stroke();
    }
  };

  useEffect(() => {
    redraw();
    if (strokes.current.length) emit();
  }, [color]); // eslint-disable-line react-hooks/exhaustive-deps

  const emit = () => {
    const c = canvasRef.current;
    onChange(c && strokes.current.length ? canvasToSignature(c) : null);
  };

  const point = (e: ReactPointerEvent<HTMLCanvasElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <canvas
          ref={canvasRef}
          aria-label="Signature drawing area. Draw with a mouse, trackpad, pen or finger."
          role="img"
          className="block h-[170px] w-full cursor-crosshair touch-none rounded-md bg-white shadow-[inset_0_0_0_1px_var(--ff-border)]"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drawing.current = true;
            strokes.current.push([point(e)]);
            setEmpty(false);
            redraw();
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
            const r = e.currentTarget.getBoundingClientRect();
            for (const ev of events) strokes.current[strokes.current.length - 1]!.push([ev.clientX - r.left, ev.clientY - r.top]);
            redraw();
          }}
          onPointerUp={() => {
            if (!drawing.current) return;
            drawing.current = false;
            emit();
          }}
          onPointerCancel={() => {
            drawing.current = false;
            emit();
          }}
        />
        <div className="pointer-events-none absolute inset-x-8 bottom-9 border-b border-dashed border-[#c9c9c4]" aria-hidden />
        {empty && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-[#9a9aa0]">Sign here</div>}
      </div>
      <div className="flex items-center justify-between">
        <ColorSwatches colors={INK_COLORS.slice(0, 3)} value={color} onChange={setColor} ariaLabel="Ink color" />
        <Button
          size="sm"
          variant="ghost"
          icon={<Eraser className="size-3.5" />}
          disabled={empty}
          onClick={() => {
            strokes.current = [];
            setEmpty(true);
            redraw();
            onChange(null);
          }}
        >
          Clear
        </Button>
      </div>
    </div>
  );
}

function TypePad({ onChange }: { onChange(image: SignatureImage | null): void }) {
  const [name, setName] = useState('');
  const [font, setFont] = useState<SignatureFontId>('dancing');
  const [color, setColor] = useState(INK_COLORS[1]!.value);
  useEffect(() => {
    let cancelled = false;
    const text = name.trim();
    if (!text) {
      onChange(null);
      return;
    }
    const t = setTimeout(() => {
      void typedSignature(text, font, color).then((img) => !cancelled && onChange(img));
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [name, font, color]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col gap-3">
      <Input autoFocus dir="auto" placeholder="Type your name" aria-label="Your name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Style">
        {SIGNATURE_FONTS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="radio"
            aria-checked={font === f.id}
            onClick={() => setFont(f.id)}
            className={cx(
              'flex h-16 flex-col items-center justify-center overflow-hidden rounded-md bg-white px-2 shadow-[inset_0_0_0_1px_var(--ff-border)]',
              font === f.id && 'shadow-[inset_0_0_0_1.5px_var(--ff-accent)]',
            )}
          >
            <span className="max-w-full truncate text-[26px] leading-tight" dir="auto" style={{ fontFamily: f.css, fontWeight: f.weight, color }}>
              {name.trim() || 'Your name'}
            </span>
            <span className="text-2xs text-[#8b8d94]">{f.label}</span>
          </button>
        ))}
      </div>
      <ColorSwatches colors={INK_COLORS.slice(0, 3)} value={color} onChange={setColor} ariaLabel="Ink color" />
    </div>
  );
}

function ImagePad({ onChange }: { onChange(image: SignatureImage | null): void }) {
  const [preview, setPreview] = useState<SignatureImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const load = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const img = await imageFileToSignature(file);
      setPreview(img);
      onChange(img);
    } catch (err) {
      setPreview(null);
      onChange(null);
      setError(err instanceof Error ? err.message : 'That image couldn’t be used.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void load(e.dataTransfer.files[0]);
        }}
        className="flex h-[150px] w-full flex-col items-center justify-center gap-1.5 rounded-md bg-white text-sm text-[#5d5f66] shadow-[inset_0_0_0_1px_var(--ff-border)] hover:shadow-[inset_0_0_0_1.5px_var(--ff-accent-border)]"
      >
        {preview ? (
          <img src={preview.dataUrl} alt="Signature preview" className="max-h-[120px] max-w-[90%] object-contain" />
        ) : (
          <>
            <ImageUp className="size-5 text-[#8b8d94]" />
            {busy ? 'Reading image…' : 'Choose or drop an image of your signature'}
            <span className="text-2xs text-[#8b8d94]">PNG, JPEG or WebP · white paper is made transparent</span>
          </>
        )}
      </button>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void load(e.target.files?.[0])} />
      {error && (
        <p className="flex items-center gap-1.5 text-xs text-danger" role="alert">
          <AlertTriangle className="size-3.5" /> {error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Review before export
// ---------------------------------------------------------------------------

function ReviewDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const model = useEditor((s) => s.model);
  const summary = useMemo(() => summarizeFields(model), [model]);
  const groups = useMemo(() => {
    const empty: FormField[] = [];
    const skipped: FormField[] = [];
    const unsure: FormField[] = [];
    for (const f of navigationList(model)) {
      const st = fieldStatus(model, f);
      if (st === 'empty') empty.push(f);
      else if (st === 'skipped') skipped.push(f);
      if (st !== 'na' && isUncertain(f)) unsure.push(f);
    }
    return { empty, skipped, unsure };
  }, [model]);
  const clean = groups.empty.length + groups.skipped.length + groups.unsure.length === 0;
  const annotations = model.annotationOrder.length;

  const jump = (f: FormField) => {
    onClose();
    ui().setGuided(true);
    focusField(f.id, { fill: true });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      width={480}
      title="Review before export"
      description={
        summary.total > 0
          ? `${summary.filled} of ${summary.total} fields filled${summary.na ? `, ${summary.na} not applicable` : ''}. Export creates a new, flattened PDF — your original stays unchanged.`
          : 'Export creates a new, flattened PDF — your original stays unchanged.'
      }
      footer={
        <>
          <Button onClick={onClose}>Keep editing</Button>
          <Button
            variant="primary"
            data-testid="review-export"
            onClick={() => {
              onClose();
              void exportDocument();
            }}
          >
            {clean ? 'Export PDF' : 'Export anyway'}
          </Button>
        </>
      }
    >
      {clean ? (
        <div className="flex items-start gap-2.5 rounded-md bg-success-soft px-3 py-2.5 text-sm">
          <CircleCheck className="mt-px size-4 shrink-0 text-success" />
          <div>
            <div className="font-medium">{summary.total > 0 ? 'Every field is filled or marked not applicable.' : 'Ready to export.'}</div>
            <div className="text-xs text-fg-secondary">
              {annotations} item{annotations === 1 ? '' : 's'} will be drawn into the pages.
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <ReviewGroup title="Still empty" fields={groups.empty} onJump={jump} />
          <ReviewGroup title="Skipped" fields={groups.skipped} onJump={jump} />
          <ReviewGroup title="Possible fields to check" hint="FormFlow wasn’t sure these are places to fill in." fields={groups.unsure} onJump={jump} />
        </div>
      )}
    </Dialog>
  );
}

function ReviewGroup({ title, hint, fields, onJump }: { title: string; hint?: string; fields: FormField[]; onJump(f: FormField): void }) {
  if (fields.length === 0) return null;
  return (
    <section>
      <h3 className="text-xs font-semibold text-fg">
        {title} <span className="font-normal tabular-nums text-fg-tertiary">{fields.length}</span>
      </h3>
      {hint && <p className="text-xs text-fg-tertiary">{hint}</p>}
      <ul className="mt-1 flex flex-col">
        {fields.slice(0, 40).map((f) => (
          <li key={f.id}>
            <button type="button" onClick={() => onJump(f)} className="flex h-7 w-full items-center gap-2 rounded-sm px-2 text-left text-sm hover:bg-hover">
              <span className="min-w-0 flex-1 truncate" dir="auto">
                {f.label ?? `Unlabelled ${FIELD_KIND_LABELS[f.kind].toLowerCase()}`}
              </span>
              <span className="text-2xs text-fg-tertiary">Page {f.pageIndex + 1}</span>
            </button>
          </li>
        ))}
        {fields.length > 40 && <li className="px-2 text-xs text-fg-tertiary">and {fields.length - 40} more</li>}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function SettingsDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const p = usePrefs();
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} width={460} title="Settings" footer={<Button onClick={onClose}>Done</Button>}>
      <div className="flex flex-col gap-4">
        <FieldRow label="Appearance">
          <Segmented<ThemePref>
            ariaLabel="Appearance"
            value={p.theme}
            onChange={(theme) => p.set({ theme })}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </FieldRow>
        <FieldRow label="Date format" htmlFor="ff-settings-date" hint="Used for new dates. Existing dates keep their format.">
          <Select id="ff-settings-date" value={p.dateFormat} onChange={(e) => p.set({ dateFormat: e.target.value as DateFormat })}>
            {DATE_FORMATS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.example}
              </option>
            ))}
          </Select>
        </FieldRow>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>
            Highlight form fields
            <span className="block text-xs text-fg-tertiary">Tint fillable areas on the page. Never part of the export.</span>
          </span>
          <input type="checkbox" className="size-4 accent-[var(--ff-accent)]" checked={p.showFieldOverlays} onChange={(e) => p.set({ showFieldOverlays: e.target.checked })} />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>Show page thumbnails</span>
          <input type="checkbox" className="size-4 accent-[var(--ff-accent)]" checked={p.showThumbnails} onChange={(e) => p.set({ showThumbnails: e.target.checked })} />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>Show properties panel</span>
          <input type="checkbox" className="size-4 accent-[var(--ff-accent)]" checked={p.showInspector} onChange={(e) => p.set({ showInspector: e.target.checked })} />
        </label>

        <div className="rounded-md bg-inset px-3 py-2.5 text-xs leading-relaxed text-fg-secondary">
          <div className="mb-1 flex items-center gap-1.5 font-medium text-fg">
            <ShieldCheck className="size-3.5 text-success" /> Privacy
          </div>
          {BRAND.name} works entirely on this device. PDFs, form values and signatures are never uploaded, and there is no telemetry. Progress is saved locally so you can resume; signatures are stored only if you choose “Remember on this device”.
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="text-danger"
            onClick={async () => {
              const ok = await confirm({
                title: 'Clear data on this device?',
                body: 'This removes recent files, saved progress for every document, and remembered signatures. Exported PDFs are not affected.',
                confirmLabel: 'Clear data',
                tone: 'danger',
              });
              if (ok !== true) return;
              await clearLocalData();
              toast({ tone: 'success', title: 'Local data cleared' });
            }}
          >
            Clear local data…
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Shortcuts
// ---------------------------------------------------------------------------

function ShortcutsDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const groups: { title: string; items: [string, string[]][] }[] = [
    {
      title: 'Tools',
      items: [
        ['Select', [TOOL_KEYS.select]],
        ['Text', [TOOL_KEYS.text]],
        ['Check mark', [TOOL_KEYS.check]],
        ['Cross mark', [TOOL_KEYS.cross]],
        ['Date', [TOOL_KEYS.date]],
        ['Signature', [TOOL_KEYS.signature]],
        ['Draw', [TOOL_KEYS.draw]],
        ['Highlight', [TOOL_KEYS.highlight]],
      ],
    },
    {
      title: 'Filling',
      items: [
        ['Next field', ['Enter']],
        ['Previous field', ['⇧ Enter']],
        ['New line in a paragraph field', ['Enter']],
        ['Finish typing', ['Esc']],
        ['Exit guided filling', ['Esc']],
      ],
    },
    {
      title: 'Editing',
      items: [
        ['Undo', [shortcutLabel('mod+z')]],
        ['Redo', [shortcutLabel('mod+shift+z')]],
        ['Duplicate', [shortcutLabel('mod+d')]],
        ['Delete', ['⌫']],
        ['Nudge (10 pt with ⇧)', ['←', '→', '↑', '↓']],
        ['Select all on page', [shortcutLabel('mod+a')]],
      ],
    },
    {
      title: 'Document',
      items: [
        ['Open', [shortcutLabel('mod+o')]],
        ['Export PDF', [shortcutLabel('mod+e')]],
        ['Close', [shortcutLabel('mod+w')]],
        ['Zoom in / out', [shortcutLabel('mod+='), shortcutLabel('mod+-')]],
        ['Actual size', [shortcutLabel('mod+0')]],
        ['Fit width / page', [shortcutLabel('mod+8'), shortcutLabel('mod+9')]],
        ['Next / previous page', ['PgDn', 'PgUp']],
        ['Settings', [shortcutLabel('mod+,')]],
      ],
    },
  ];
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} width={600} title="Keyboard shortcuts">
      <div className="grid grid-cols-2 gap-x-8 gap-y-4 pb-2 max-[640px]:grid-cols-1">
        {groups.map((g) => (
          <section key={g.title}>
            <h3 className="mb-1.5 text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">{g.title}</h3>
            <dl className="flex flex-col gap-1">
              {g.items.map(([label, keys]) => (
                <div key={label} className="flex items-center justify-between gap-3 text-sm">
                  <dt className="text-fg-secondary">{label}</dt>
                  <dd className="flex gap-1">
                    {keys.map((k) => (
                      <Kbd key={k}>{k}</Kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
