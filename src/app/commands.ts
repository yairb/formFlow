import { fitScale, zoomStep } from '@/workspace/layout';
import { documentState } from '@/state/document';
import { editor } from '@/state/editor';
import { ui, type Tool } from '@/state/ui';

/**
 * Small user-level commands shared by the header, toolbar, menus and keyboard
 * shortcuts, so every entry point behaves identically.
 */

function syncSelectionWithModel(): void {
  const m = editor().model;
  const s = ui();
  const sel = s.selection.filter((id) => m.annotations[id]);
  if (sel.length !== s.selection.length) s.select(sel);
  if (s.editing?.kind === 'annotation' && !m.annotations[s.editing.id]) s.setEditing(null);
}

export function undo(): void {
  if (ui().editing?.kind === 'draft') ui().setEditing(null);
  const label = editor().undo();
  syncSelectionWithModel();
  ui().flash(label ? `Undid ${label.toLowerCase()}` : 'Nothing to undo');
}

export function redo(): void {
  const label = editor().redo();
  syncSelectionWithModel();
  ui().flash(label ? `Redid ${label.toLowerCase()}` : 'Nothing to redo');
}

export function setTool(tool: Tool): void {
  ui().setTool(tool);
}

export function zoomBy(direction: 1 | -1): void {
  ui().setZoom('custom', zoomStep(ui().scale, direction));
}

/** 100% = the page's physical size on a 96 dpi screen. */
export function zoomTo(percent: number): void {
  ui().setZoom('custom', (percent / 100) * (96 / 72));
}

export function fit(mode: 'fit-width' | 'fit-page'): void {
  const pdf = documentState().pdf;
  const el = document.querySelector<HTMLElement>('[data-testid="workspace"]');
  if (!pdf || !el) return ui().setZoom(mode);
  ui().setZoom(mode, fitScale(pdf.pages, mode, { width: el.clientWidth, height: el.clientHeight }, ui().currentPage));
}

export function goToPage(index: number): void {
  const pdf = documentState().pdf;
  if (!pdf) return;
  const i = Math.max(0, Math.min(pdf.pages.length - 1, index));
  ui().setCurrentPage(i);
  ui().requestScroll(i, undefined, true);
}

export const scalePercent = (scale: number) => Math.round((scale / (96 / 72)) * 100);
