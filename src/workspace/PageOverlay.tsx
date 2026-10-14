import { memo, useCallback, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  addInkStroke,
  editField,
  placeDate,
  placeHighlight,
  placeMark,
  placeSignature,
  startTextDraft,
} from '@/app/editActions';
import { handlesFor, locksAspect, MIN_ANNOTATION_SIZE, moveAnnotationTo, resizeRect, updateAnnotation, type Handle } from '@/model/annotations';
import { boundAnnotations, fieldStatus, isUncertain } from '@/model/fields';
import { smoothStrokePath, toSvgPath } from '@/model/paths';
import type { Annotation, AnnotationId, DocModel, FormField } from '@/model/types';
import { clientToDisplay, rectFromPoints, type PageGeometry, type Point, type Rect } from '@/pdf/geometry';
import { editor, useEditor } from '@/state/editor';
import { usePrefs } from '@/state/prefs';
import { activeSignature } from '@/state/signatures';
import { ui, useUi, type Tool } from '@/state/ui';
import { cx } from '@/components/ui/cx';
import { AnnotationContent } from './AnnotationView';
import { SelectionFrame } from './SelectionFrame';
import { TextEditor } from './TextEditor';

const DRAG_THRESHOLD_PX = 3;

type Drag =
  | { kind: 'move'; pointerId: number; origin: Point; startClient: Point; rects: Map<AnnotationId, Rect>; moved: boolean }
  | { kind: 'resize'; pointerId: number; id: AnnotationId; handle: Handle; origin: Point; rect: Rect; moved: boolean }
  | { kind: 'ink'; pointerId: number; points: Point[] }
  | { kind: 'highlight'; pointerId: number; origin: Point; current: Point };

const TOOL_CURSOR: Record<Tool, string> = {
  select: 'default',
  text: 'text',
  check: 'crosshair',
  cross: 'crosshair',
  date: 'copy',
  signature: 'copy',
  draw: 'crosshair',
  highlight: 'crosshair',
};

function pageAnnotations(m: DocModel, pageIndex: number): Annotation[] {
  const out: Annotation[] = [];
  for (const id of m.annotationOrder) {
    const a = m.annotations[id];
    if (a && a.pageIndex === pageIndex) out.push(a);
  }
  return out;
}

function pageFields(m: DocModel, pageIndex: number): FormField[] {
  const out: FormField[] = [];
  for (const id of m.fieldOrder) {
    const f = m.fields[id];
    if (f && f.pageIndex === pageIndex && f.review !== 'rejected') out.push(f);
  }
  return out;
}

/**
 * Interactive layer over one rendered page. Everything here is positioned from
 * display-space geometry multiplied by `scale` — the same numbers the exporter uses.
 */
export const PageOverlay = memo(function PageOverlay({ geom, scale }: { geom: PageGeometry; scale: number }) {
  const pageIndex = geom.index;
  const rootRef = useRef<HTMLDivElement>(null);
  const model = useEditor((s) => s.model);
  const tool = useUi((s) => s.tool);
  const selection = useUi((s) => s.selection);
  const editing = useUi((s) => s.editing);
  const activeFieldId = useUi((s) => s.activeFieldId);
  const guided = useUi((s) => s.guided);
  const showFields = usePrefs((s) => s.showFieldOverlays);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);

  const annotations = useMemo(() => pageAnnotations(model, pageIndex), [model.annotations, model.annotationOrder, pageIndex]); // eslint-disable-line react-hooks/exhaustive-deps
  const fields = useMemo(() => pageFields(model, pageIndex), [model.fields, model.fieldOrder, pageIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  const editingId = editing?.kind === 'annotation' ? editing.id : null;
  const draftHere = editing?.kind === 'draft' && editing.draft.pageIndex === pageIndex ? editing.draft : null;
  const editingHere = editingId && model.annotations[editingId]?.pageIndex === pageIndex ? editingId : null;
  const selectedHere = selection.filter((id) => model.annotations[id]?.pageIndex === pageIndex);

  const toDisplay = useCallback(
    (e: { clientX: number; clientY: number }): Point => {
      const r = rootRef.current!.getBoundingClientRect();
      const p = clientToDisplay(e.clientX, e.clientY, r, scale);
      return { x: Math.min(Math.max(p.x, 0), geom.width), y: Math.min(Math.max(p.y, 0), geom.height) };
    },
    [scale, geom.width, geom.height],
  );

  const setDragState = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  const beginMove = (e: ReactPointerEvent, ids: AnnotationId[]) => {
    const m = editor().model;
    const rects = new Map<AnnotationId, Rect>();
    for (const id of ids) {
      const a = m.annotations[id];
      if (a && a.pageIndex === pageIndex) rects.set(id, a.rect);
    }
    rootRef.current!.setPointerCapture(e.pointerId);
    setDragState({ kind: 'move', pointerId: e.pointerId, origin: toDisplay(e), startClient: { x: e.clientX, y: e.clientY }, rects, moved: false });
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || dragRef.current) return;
    const target = e.target as HTMLElement;
    const annEl = target.closest<HTMLElement>('[data-ann-id]');
    const fieldEl = target.closest<HTMLElement>('[data-field-id]');
    const annId = annEl?.dataset.annId ?? null;
    const ann = annId ? editor().model.annotations[annId] : undefined;
    const p = toDisplay(e);

    // A click elsewhere ends text editing first (the editor commits on blur).
    if (editing) {
      ui().setEditing(null);
      if (tool === 'select' && !ann) {
        ui().select([]);
        return;
      }
    }

    switch (tool) {
      case 'select': {
        if (ann) {
          e.preventDefault();
          const sel = ui().selection;
          if (e.shiftKey || e.metaKey || e.ctrlKey) {
            ui().select(sel.includes(ann.id) ? sel.filter((id) => id !== ann.id) : [...sel, ann.id]);
            return;
          }
          const ids = sel.includes(ann.id) ? sel : [ann.id];
          ui().select(ids);
          if (ann.fieldId) ui().setActiveField(ann.fieldId);
          beginMove(e, ids);
          return;
        }
        const field = fieldEl ? editor().model.fields[fieldEl.dataset.fieldId!] : null;
        if (field) {
          e.preventDefault();
          activateField(field);
          return;
        }
        ui().select([]);
        ui().setActiveField(null);
        return;
      }
      case 'text': {
        e.preventDefault();
        if (ann?.type === 'text') {
          ui().select([]);
          ui().setEditing({ kind: 'annotation', id: ann.id });
          return;
        }
        startTextDraft(pageIndex, p);
        return;
      }
      case 'check':
      case 'cross':
        e.preventDefault();
        placeMark(pageIndex, p, tool);
        return;
      case 'date':
        e.preventDefault();
        placeDate(pageIndex, p);
        return;
      case 'signature': {
        e.preventDefault();
        if (!activeSignature()) {
          ui().openDialog({ kind: 'signature', place: { pageIndex, at: p } });
          return;
        }
        placeSignature(pageIndex, p);
        return;
      }
      case 'draw':
        e.preventDefault();
        rootRef.current!.setPointerCapture(e.pointerId);
        setDragState({ kind: 'ink', pointerId: e.pointerId, points: [p] });
        return;
      case 'highlight':
        e.preventDefault();
        rootRef.current!.setPointerCapture(e.pointerId);
        setDragState({ kind: 'highlight', pointerId: e.pointerId, origin: p, current: p });
        return;
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const p = toDisplay(e);
    switch (d.kind) {
      case 'move': {
        if (!d.moved && Math.hypot(e.clientX - d.startClient.x, e.clientY - d.startClient.y) < DRAG_THRESHOLD_PX) return;
        if (!d.moved) editor().beginGesture();
        const dx = p.x - d.origin.x;
        const dy = p.y - d.origin.y;
        editor().updateGesture((m) => {
          let next = m;
          for (const [id, r] of d.rects) next = moveAnnotationTo(next, id, { ...r, x: r.x + dx, y: r.y + dy }, geom);
          return next;
        });
        if (!d.moved) setDragState({ ...d, moved: true });
        return;
      }
      case 'resize': {
        const a = editor().model.annotations[d.id];
        if (!a) return;
        if (!d.moved) editor().beginGesture();
        const minW = a.type === 'text' ? a.fontSize * 0.8 : MIN_ANNOTATION_SIZE;
        const rect = resizeRect(d.rect, d.handle, p.x - d.origin.x, p.y - d.origin.y, {
          lockAspect: locksAspect(a),
          minWidth: minW,
          minHeight: MIN_ANNOTATION_SIZE,
          bounds: geom,
        });
        // updateAnnotation refits a text box's height to its new width.
        editor().updateGesture((m) =>
          updateAnnotation(m, d.id, (cur) =>
            cur.type === 'text' ? { ...cur, autoWidth: false, rect: { ...cur.rect, x: rect.x, width: rect.width } } : { ...cur, rect },
          ),
        );
        if (!d.moved) setDragState({ ...d, moved: true });
        return;
      }
      case 'ink': {
        const events = 'getCoalescedEvents' in e.nativeEvent ? e.nativeEvent.getCoalescedEvents() : [];
        const pts = events.length ? events.map((ev) => toDisplay(ev)) : [p];
        setDragState({ ...d, points: [...d.points, ...pts] });
        return;
      }
      case 'highlight':
        setDragState({ ...d, current: p });
        return;
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    setDragState(null);
    switch (d.kind) {
      case 'move':
        if (d.moved && editor().endGesture('Move')) ui().flash('Moved');
        return;
      case 'resize':
        if (d.moved) editor().endGesture('Resize');
        return;
      case 'ink':
        addInkStroke(pageIndex, d.points);
        return;
      case 'highlight':
        placeHighlight(pageIndex, rectFromPoints(d.origin, d.current));
        return;
    }
  };

  const onPointerCancel = () => {
    const d = dragRef.current;
    if (!d) return;
    setDragState(null);
    if (d.kind === 'move' || d.kind === 'resize') editor().cancelGesture();
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (tool !== 'select') return;
    const annEl = (e.target as HTMLElement).closest<HTMLElement>('[data-ann-id]');
    const a = annEl ? editor().model.annotations[annEl.dataset.annId!] : undefined;
    if (a?.type === 'text') {
      ui().select([]);
      ui().setEditing({ kind: 'annotation', id: a.id });
    }
  };

  const onHandleDown = (id: AnnotationId) => (handle: Handle, e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const a = editor().model.annotations[id];
    if (!a) return;
    rootRef.current!.setPointerCapture(e.pointerId);
    setDragState({ kind: 'resize', pointerId: e.pointerId, id, handle, origin: toDisplay(e), rect: a.rect, moved: false });
  };

  const interactiveAnnotations = tool === 'select' || tool === 'text';
  const single = selectedHere.length === 1 ? model.annotations[selectedHere[0]!] : undefined;

  return (
    <div
      ref={rootRef}
      className="absolute inset-0"
      style={{ cursor: drag?.kind === 'move' && drag.moved ? 'grabbing' : TOOL_CURSOR[tool], touchAction: tool === 'draw' || tool === 'highlight' ? 'none' : 'pan-x pan-y' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
      onDoubleClick={onDoubleClick}
      data-page-overlay={pageIndex}
    >
      {showFields && (
        <FieldLayer fields={fields} model={model} scale={scale} activeFieldId={activeFieldId} guided={guided} clickable={tool === 'select'} />
      )}

      {annotations.map((a) => (
        <div
          key={a.id}
          data-ann-id={a.id}
          className={cx('absolute', interactiveAnnotations && (tool === 'select' || a.type === 'text') ? 'pointer-events-auto' : 'pointer-events-none')}
          style={{
            left: a.rect.x * scale,
            top: a.rect.y * scale,
            width: a.rect.width * scale,
            height: a.rect.height * scale,
            cursor: tool === 'select' ? (drag?.kind === 'move' && drag.moved ? 'grabbing' : 'move') : tool === 'text' && a.type === 'text' ? 'text' : undefined,
          }}
        >
          <AnnotationContent a={a} scale={scale} hideText={a.id === editingHere} />
        </div>
      ))}

      {selectedHere.map((id) => {
        const a = model.annotations[id]!;
        return (
          <SelectionFrame
            key={id}
            rect={a.rect}
            scale={scale}
            handles={single && a.id === single.id && drag?.kind !== 'move' ? handlesFor(a) : []}
            onHandleDown={onHandleDown(id)}
          />
        );
      })}

      {editingHere && (
        <>
          <SelectionFrame rect={model.annotations[editingHere]!.rect} scale={scale} handles={[]} editing />
          <TextEditor key={editingHere} target={{ id: editingHere }} scale={scale} />
        </>
      )}
      {draftHere && <TextEditor key={`draft:${draftHere.at.x},${draftHere.at.y}`} target={{ draft: draftHere }} scale={scale} />}

      {drag?.kind === 'ink' && <InkPreview points={drag.points} scale={scale} geom={geom} />}
      {drag?.kind === 'highlight' && <HighlightPreview rect={rectFromPoints(drag.origin, drag.current)} scale={scale} />}
    </div>
  );
});

function activateField(field: FormField): void {
  const m = editor().model;
  if (field.kind === 'text' || field.kind === 'multiline' || field.kind === 'date') {
    editField(field);
    return;
  }
  ui().setActiveField(field.id);
  if (field.kind === 'checkbox' || field.kind === 'radio') {
    const c = { x: field.rect.x + field.rect.width / 2, y: field.rect.y + field.rect.height / 2 };
    placeMark(field.pageIndex, c, 'check');
    return;
  }
  if (field.kind === 'signature') {
    const at = { x: field.rect.x + field.rect.width / 2, y: field.rect.y + field.rect.height / 2 };
    if (!activeSignature()) ui().openDialog({ kind: 'signature', place: { pageIndex: field.pageIndex, at, fieldId: field.id } });
    else placeSignature(field.pageIndex, at);
    return;
  }
  const bound = boundAnnotations(m, field.id);
  if (bound[0]) ui().select([bound[0].id]);
}

const FieldLayer = memo(function FieldLayer({
  fields,
  model,
  scale,
  activeFieldId,
  guided,
  clickable,
}: {
  fields: FormField[];
  model: DocModel;
  scale: number;
  activeFieldId: string | null;
  guided: boolean;
  clickable: boolean;
}) {
  return (
    <>
      {fields.map((f) => {
        if (f.native?.readOnly) return null;
        const status = fieldStatus(model, f);
        const active = f.id === activeFieldId;
        const uncertain = isUncertain(f);
        const line = f.shape === 'line';
        return (
          <div
            key={f.id}
            data-field-id={f.id}
            aria-hidden
            className={cx(
              'absolute rounded-[2px] transition-[background-color,box-shadow,border-color] duration-150',
              clickable ? 'pointer-events-auto cursor-pointer' : 'pointer-events-none',
              status === 'filled' || status === 'na'
                ? 'bg-[var(--ff-doc-field-done)]'
                : uncertain
                  ? 'bg-[var(--ff-doc-field-uncertain)]'
                  : 'bg-[var(--ff-doc-field)]',
              line ? 'border-b-2' : 'border',
              status === 'filled' || status === 'na'
                ? 'border-transparent'
                : uncertain
                  ? 'border-dashed border-[var(--ff-doc-field-uncertain-border)]'
                  : 'border-[var(--ff-doc-field-border)]',
              f.review === 'suggested' && 'border-dashed',
              active && 'ff-field-active',
              status === 'na' && 'opacity-50',
              guided && !active && 'opacity-70',
            )}
            style={{
              left: f.rect.x * scale,
              top: f.rect.y * scale,
              width: f.rect.width * scale,
              height: f.rect.height * scale,
              borderRadius: f.shape === 'circle' ? '999px' : undefined,
            }}
          />
        );
      })}
    </>
  );
});

function InkPreview({ points, scale, geom }: { points: Point[]; scale: number; geom: PageGeometry }) {
  const { inkColor, inkWidth } = usePrefs.getState();
  return (
    <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" viewBox={`0 0 ${geom.width} ${geom.height}`} style={{ width: geom.width * scale, height: geom.height * scale }}>
      <path d={toSvgPath(smoothStrokePath(points))} fill="none" stroke={inkColor} strokeWidth={inkWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function HighlightPreview({ rect, scale }: { rect: Rect; scale: number }) {
  const color = usePrefs.getState().highlightColor;
  return (
    <div
      className="pointer-events-none absolute mix-blend-multiply"
      style={{ left: rect.x * scale, top: rect.y * scale, width: rect.width * scale, height: rect.height * scale, background: color, opacity: 0.38 }}
    />
  );
}

