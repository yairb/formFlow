import { Loader2 } from 'lucide-react';
import { useDocument } from '@/state/document';
import { usePrefs } from '@/state/prefs';
import { Workspace } from '@/workspace/Workspace';
import { Dialogs } from './Dialogs';
import { EmptyState } from './EmptyState';
import { Modals, StatusFlash, Toasts } from './Feedback';
import { GuidedPanel } from './GuidedPanel';
import { Header } from './Header';
import { Inspector } from './Inspector';
import { Sidebar } from './Sidebar';
import { Toolbar, ToolHint } from './Toolbar';
import { ZoomControls } from './ZoomControls';

export function AppShell({ dragging }: { dragging: boolean }) {
  const status = useDocument((s) => s.status);
  const pdf = useDocument((s) => s.pdf);
  const session = useDocument((s) => s.session);
  const loadingName = useDocument((s) => s.loadingName);
  const loadingDetail = useDocument((s) => s.loadingDetail);
  const showThumbnails = usePrefs((s) => s.showThumbnails);
  const showInspector = usePrefs((s) => s.showInspector);

  return (
    <div className="flex h-full flex-col">
      <Header />
      <main className="relative flex min-h-0 flex-1">
        {pdf && status !== 'empty' ? (
          <>
            {showThumbnails && <Sidebar key={`sb${session}`} doc={pdf.doc} pages={pdf.pages} />}
            <div className="relative flex min-w-0 flex-1 flex-col">
              <Workspace key={session} doc={pdf.doc} pages={pdf.pages} />
              <div className="pointer-events-none absolute inset-x-0 top-3 z-[var(--ff-z-workspace-float)] flex flex-col items-center gap-2 px-3">
                <Toolbar />
                <ToolHint />
              </div>
              <div className="pointer-events-none absolute inset-x-0 bottom-3 z-[var(--ff-z-workspace-float)] flex flex-col items-center gap-2 px-3">
                <StatusFlash />
                <GuidedPanel />
                <ZoomControls pageCount={pdf.pages.length} />
              </div>
            </div>
            {showInspector && <Inspector />}
          </>
        ) : (
          <div className="min-w-0 flex-1">
            <EmptyState dragging={dragging} />
          </div>
        )}
        {status === 'loading' && <LoadingOverlay name={loadingName} detail={loadingDetail} />}
        {dragging && status === 'ready' && <DropOverlay />}
      </main>
      <Toasts />
      <Modals />
      <Dialogs />
    </div>
  );
}

function LoadingOverlay({ name, detail }: { name: string | null; detail: string | null }) {
  return (
    <div className="ff-animate-fade absolute inset-0 z-[var(--ff-z-panel)] flex items-center justify-center bg-canvas/70 backdrop-blur-[2px]" role="status" aria-live="polite">
      <div className="flex items-center gap-2.5 rounded-md bg-elevated px-4 py-3 text-sm shadow-md">
        <Loader2 className="size-4 shrink-0 animate-spin text-accent" />
        <div className="min-w-0">
          <div className="max-w-[22rem] truncate">Opening {name ? `“${name}”` : 'document'}…</div>
          {detail && <div className="text-xs text-fg-tertiary tabular-nums">{detail}</div>}
        </div>
      </div>
    </div>
  );
}

function DropOverlay() {
  return (
    <div className="ff-animate-fade pointer-events-none absolute inset-3 z-[var(--ff-z-panel)] flex items-center justify-center rounded-lg border-2 border-dashed border-accent bg-accent-softer backdrop-blur-[1px]">
      <div className="rounded-md bg-elevated px-4 py-2.5 text-md font-medium shadow-md">Drop to open this PDF</div>
    </div>
  );
}
