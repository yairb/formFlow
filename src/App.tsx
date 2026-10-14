import { useEffect, useState } from 'react';
import { hasUnsavedWork, openPicked } from '@/app/documentActions';
import { sessions } from '@/app/sessions';
import { TooltipProvider } from '@/components/ui/Tooltip';
import { platform } from '@/platform';
import { fileToPicked } from '@/platform/web';
import { confirm, toast } from '@/state/feedback';
import { usePrefs } from '@/state/prefs';
import { AppShell } from '@/shell/AppShell';
import { useGlobalShortcuts } from '@/shell/shortcuts';

const MAX_DROP_BYTES = 200 * 1024 * 1024;

export function App() {
  const [dragging, setDragging] = useState(false);
  useGlobalShortcuts();
  useTheme();

  // Close protection: autosave flushes first; unexported work asks before quitting.
  useEffect(
    () =>
      platform().onCloseRequested(async () => {
        await sessions.persistNow();
        if (!hasUnsavedWork()) return true;
        const choice = await confirm({
          title: 'Quit with unexported changes?',
          body: 'Your progress is saved on this device and will be offered when you reopen the file, but no filled PDF has been exported yet.',
          confirmLabel: 'Quit',
          cancelLabel: 'Keep working',
        });
        return choice === true;
      }, hasUnsavedWork),
    [],
  );

  // Drag and drop of PDF files anywhere in the window.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = async (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const files = [...(e.dataTransfer?.files ?? [])];
      const file = files.find((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
      if (!file) {
        toast({ tone: 'warning', title: 'Not a PDF', body: 'Drop a .pdf file to open it.' });
        return;
      }
      if (file.size > MAX_DROP_BYTES) {
        toast({ tone: 'danger', title: 'File too large', body: 'PDFs up to 200 MB can be opened.' });
        return;
      }
      if (files.length > 1) toast({ tone: 'info', title: `Opening “${file.name}”`, body: 'One document can be open at a time.' });
      await openPicked(await fileToPicked(file));
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  return (
    <TooltipProvider>
      <AppShell dragging={dragging} />
    </TooltipProvider>
  );
}

function useTheme(): void {
  const theme = usePrefs((s) => s.theme);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}
