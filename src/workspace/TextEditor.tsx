import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { applyText, finishText } from '@/app/editActions';
import { createTextAnnotation } from '@/model/annotations';
import { layoutFieldText } from '@/model/fields';
import type { TextAnnotation } from '@/model/types';
import { useEditor } from '@/state/editor';
import { fillDefaults, usePrefs } from '@/state/prefs';
import { ui, useUi, type TextDraft } from '@/state/ui';
import { familyCss, familySupportsBold } from '@/text/fonts';
import { lineHeightPt } from '@/text/metrics';

/**
 * In-place text editing. A transparent textarea sits exactly over the annotation's
 * box using the document font, so the caret and selection line up with the text;
 * the model (and therefore the box size) updates on every keystroke.
 */
export function TextEditor({ target, scale }: { target: { draft: TextDraft } | { id: string }; scale: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [id, setId] = useState<string | null>('id' in target ? target.id : null);
  const annotation = useEditor((s) => (id ? s.model.annotations[id] : undefined)) as TextAnnotation | undefined;
  const field = useEditor((s) => {
    const fid = annotation?.fieldId ?? ('draft' in target ? target.draft.fieldId : undefined);
    return fid ? s.model.fields[fid] : undefined;
  });
  const p = usePrefs();
  const [value, setValue] = useState(annotation?.text ?? '');

  // Geometry for a draft: what the annotation will look like once it exists.
  const shape: TextAnnotation =
    annotation ??
    (() => {
      const draft = (target as { draft: TextDraft }).draft;
      const base = createTextAnnotation(draft.pageIndex, draft.at, { fontSize: p.fontSize, fontFamily: p.fontFamily, color: p.textColor });
      if (field) {
        const d = fillDefaults(p);
        return layoutFieldText(field, { ...base, fontFamily: d.fontFamily, color: d.color, fontSize: Math.min(d.maxFontSize, Math.max(6, field.rect.height * 0.62)), autoWidth: false, align: field.rtl ? 'right' : 'left' });
      }
      return base;
    })();

  // Keep the textarea in sync when undo/redo changes the text underneath it.
  useEffect(() => {
    if (annotation && annotation.text !== value) setValue(annotation.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotation?.text]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, []);

  // When the editor closes, an empty annotation is removed.
  const idRef = useRef(id);
  idRef.current = id;
  useEffect(() => () => {
    if (idRef.current) finishText(idRef.current);
  }, []);

  // The annotation disappeared (undo of its creation): stop editing.
  useEffect(() => {
    if (id && !annotation) ui().setEditing(null);
  }, [id, annotation]);

  const onChange = (text: string) => {
    setValue(text);
    const newId = applyText(id ? { id } : target, text);
    if (newId && newId !== id) {
      setId(newId);
      useUi.setState({ editing: { kind: 'annotation', id: newId } });
    }
  };

  const close = () => {
    const current = idRef.current;
    ui().setEditing(null);
    if (current && ui().tool === 'select') ui().select([current]);
  };

  const lh = lineHeightPt(shape.fontSize) * scale;
  const extra = shape.autoWidth ? Math.max(shape.fontSize * scale, 12) : 0;
  return (
    <textarea
      ref={ref}
      value={value}
      aria-label={field?.label ? `Value for ${field.label}` : 'Text'}
      spellCheck={false}
      wrap={shape.autoWidth ? 'off' : 'soft'}
      onChange={(e) => onChange(e.target.value)}
      onBlur={close}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          close();
        } else if (e.key === 'Enter' && field && field.kind !== 'multiline') {
          e.preventDefault();
          close();
          window.dispatchEvent(new CustomEvent('ff:field-next', { detail: field.id }));
        }
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className="ff-doc-text absolute m-0 resize-none overflow-hidden border-0 bg-transparent p-0 outline-none"
      style={{
        left: shape.rect.x * scale,
        top: shape.rect.y * scale,
        width: shape.rect.width * scale + extra,
        height: Math.max(shape.rect.height * scale, lh) + 2,
        fontFamily: familyCss(shape.fontFamily),
        fontWeight: shape.bold && familySupportsBold(shape.fontFamily) ? 700 : 400,
        fontSize: shape.fontSize * scale,
        lineHeight: `${lh}px`,
        color: shape.color,
        caretColor: 'var(--ff-accent)',
        textAlign: shape.align,
        whiteSpace: shape.autoWidth ? 'pre' : 'pre-wrap',
        overflowWrap: 'anywhere',
        unicodeBidi: 'plaintext',
      }}
    />
  );
}
