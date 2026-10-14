import { useEffect } from 'react';
import { closeDocument, openFromPicker, requestExport } from '@/app/documentActions';
import { fit, goToPage, redo, setTool, undo, zoomBy, zoomTo } from '@/app/commands';
import { deleteSelection, duplicateSelection, nudgeSelection, selectAllOnPage } from '@/app/editActions';
import { platform } from '@/platform';
import { documentState } from '@/state/document';
import { useFeedback } from '@/state/feedback';
import { ui, type Tool } from '@/state/ui';

export const TOOL_KEYS: Record<Tool, string> = {
  select: 'V',
  text: 'T',
  check: 'K',
  cross: 'X',
  date: 'D',
  signature: 'S',
  draw: 'P',
  highlight: 'H',
};

/** Renders a shortcut like "mod+shift+z" for the current platform. */
export function shortcutLabel(combo: string): string {
  const mac = platform().isMac;
  return combo
    .split('+')
    .map((k) => {
      switch (k) {
        case 'mod':
          return mac ? '⌘' : 'Ctrl';
        case 'shift':
          return mac ? '⇧' : 'Shift';
        case 'alt':
          return mac ? '⌥' : 'Alt';
        default:
          return k.length === 1 ? k.toUpperCase() : k;
      }
    })
    .join(mac ? '' : '+');
}

function isTextInput(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) return !['checkbox', 'radio', 'button', 'range', 'submit'].includes(el.type);
  return false;
}

const TOOL_BY_KEY = Object.fromEntries(Object.entries(TOOL_KEYS).map(([t, k]) => [k.toLowerCase(), t as Tool]));

/** Global keyboard shortcuts. Inputs and open dialogs keep their own keys. */
export function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const mod = platform().isMac ? e.metaKey : e.ctrlKey;
      const key = e.key.toLowerCase();
      const inInput = isTextInput(e.target);
      const modalOpen = useFeedback.getState().modal !== null || ui().dialog !== null || document.querySelector('[role="dialog"]');
      const ready = documentState().status === 'ready';

      // Document-level commands work everywhere except inside dialogs.
      if (mod && !modalOpen) {
        if (key === 'o') return run(e, () => void openFromPicker());
        if (key === ',') return run(e, () => ui().openDialog({ kind: 'settings' }));
        if (!ready) return;
        if (key === 'e' || (key === 's' && e.shiftKey)) return run(e, () => requestExport());
        if (key === 's') return run(e, () => ui().flash('Progress is saved automatically — use Export PDF to create the filled file'));
        if (key === 'w') return run(e, () => void closeDocument());
        if (key === '=' || key === '+') return run(e, () => zoomBy(1));
        if (key === '-') return run(e, () => zoomBy(-1));
        if (key === '0') return run(e, () => zoomTo(100));
        if (key === '9') return run(e, () => fit('fit-page'));
        if (key === '8') return run(e, () => fit('fit-width'));
        if (inInput) return;
        if (key === 'z') return run(e, () => (e.shiftKey ? redo() : undo()));
        if (key === 'y') return run(e, redo);
        if (key === 'd') return run(e, duplicateSelection);
        if (key === 'a') return run(e, () => selectAllOnPage(ui().currentPage));
        return;
      }
      if (!ready || inInput || modalOpen || e.altKey || mod || e.ctrlKey || e.metaKey) return;

      switch (e.key) {
        case 'Escape':
          if (ui().editing) return run(e, () => ui().setEditing(null));
          if (ui().selection.length) return run(e, () => ui().select([]));
          if (ui().tool !== 'select') return run(e, () => setTool('select'));
          if (ui().guided) return run(e, () => ui().setGuided(false));
          return;
        case 'Delete':
        case 'Backspace':
          if (ui().selection.length) run(e, deleteSelection);
          return;
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'ArrowUp':
        case 'ArrowDown': {
          const step = e.shiftKey ? 10 : 1;
          if (ui().selection.length) {
            const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
            const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
            return run(e, () => nudgeSelection(dx, dy));
          }
          return;
        }
        case 'PageDown':
          return run(e, () => goToPage(ui().currentPage + 1));
        case 'PageUp':
          return run(e, () => goToPage(ui().currentPage - 1));
        case '?':
          return run(e, () => ui().openDialog({ kind: 'shortcuts' }));
      }
      if (e.shiftKey) return;
      const tool = TOOL_BY_KEY[key];
      if (tool) run(e, () => setTool(tool));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function run(e: KeyboardEvent, fn: () => void): void {
  e.preventDefault();
  fn();
}
