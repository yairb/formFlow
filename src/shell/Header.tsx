import { useMemo } from 'react';
import { CircleCheck, CloudOff, FileDown, FolderOpen, Keyboard, ListChecks, MoreHorizontal, Redo2, Settings2, Undo2, X } from 'lucide-react';
import { closeDocument, openFromPicker, requestExport } from '@/app/documentActions';
import { startGuided, stopGuided } from '@/app/fieldActions';
import { redo, undo } from '@/app/commands';
import { useRecents } from '@/app/sessions';
import { BRAND } from '@/brand';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/Menu';
import { Tooltip } from '@/components/ui/Tooltip';
import { summarizeFields } from '@/model/fields';
import { useDocument } from '@/state/document';
import { selectIsDirty, useEditor } from '@/state/editor';
import { ui, useUi } from '@/state/ui';
import { shortcutLabel } from './shortcuts';
import { LogoMark } from './LogoMark';

export function Header() {
  const status = useDocument((s) => s.status);
  const file = useDocument((s) => s.file);
  const ready = status === 'ready';

  return (
    <header
      className="drag-region relative z-[var(--ff-z-panel)] flex h-[var(--ff-header-height)] shrink-0 items-center gap-3 border-b border-line bg-chrome pl-[max(14px,env(titlebar-area-x,0px))] pr-2.5"
      data-tauri-drag-region
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <div className="flex items-center gap-2" aria-label={BRAND.name}>
          <LogoMark className="size-[22px]" />
          <span className={ready ? 'sr-only' : 'text-md font-semibold tracking-[-0.01em]'}>{BRAND.name}</span>
        </div>
        {ready && file && <DocumentTitle name={file.name} />}
      </div>

      {ready && <HistoryButtons />}
      {ready && <FillButton />}
      <div className="no-drag flex items-center gap-1.5">
        {ready && (
          <Button variant="primary" icon={<FileDown className="size-[15px]" />} onClick={() => requestExport()} aria-keyshortcuts="Meta+E">
            Export PDF
          </Button>
        )}
        <AppMenu ready={ready} />
      </div>
    </header>
  );
}

function DocumentTitle({ name }: { name: string }) {
  const dirty = useEditor(selectIsDirty);
  const saveState = useRecents((s) => s.saveState);
  const stem = name.replace(/\.pdf$/i, '');
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="text-fg-disabled">/</span>
      <h1 className="truncate text-md font-medium text-fg" title={name}>
        {stem}
        <span className="text-fg-tertiary">.pdf</span>
      </h1>
      {dirty && (
        <Tooltip label="Changes not yet exported">
          <span className="no-drag size-[7px] shrink-0 rounded-full bg-warning" role="status" aria-label="Unexported changes" />
        </Tooltip>
      )}
      <SaveStatus state={saveState} />
    </div>
  );
}

function SaveStatus({ state }: { state: 'idle' | 'saving' | 'saved' | 'error' }) {
  if (state === 'error') {
    return (
      <Tooltip label="Progress couldn’t be saved on this device. Export to keep your work.">
        <span className="no-drag flex items-center gap-1 text-xs text-danger">
          <CloudOff className="size-3.5" /> Not saved
        </span>
      </Tooltip>
    );
  }
  if (state === 'idle') return null;
  return (
    <Tooltip label="Your progress is stored locally and restored if you reopen this file. The original PDF is never modified.">
      <span className="no-drag flex items-center gap-1 whitespace-nowrap text-xs text-fg-tertiary" role="status" aria-live="polite">
        {state === 'saving' ? (
          'Saving…'
        ) : (
          <>
            <CircleCheck className="size-3.5 text-success" /> Saved on this device
          </>
        )}
      </span>
    </Tooltip>
  );
}

function HistoryButtons() {
  const canUndo = useEditor((s) => s.past.length > 0 || s.gestureBase !== null);
  const canRedo = useEditor((s) => s.future.length > 0);
  return (
    <div className="no-drag flex items-center">
      <IconButton label="Undo" shortcut={shortcutLabel('mod+z')} onClick={undo} disabled={!canUndo}>
        <Undo2 />
      </IconButton>
      <IconButton label="Redo" shortcut={shortcutLabel('mod+shift+z')} onClick={redo} disabled={!canRedo}>
        <Redo2 />
      </IconButton>
    </div>
  );
}

function FillButton() {
  const guided = useUi((s) => s.guided);
  const model = useEditor((s) => s.model);
  const summary = useMemo(() => summarizeFields(model), [model]);
  if (summary.total === 0) return null;
  const done = summary.filled + summary.na;
  return (
    <Button
      variant={guided ? 'subtle' : 'ghost'}
      className="no-drag"
      icon={<ListChecks className="size-[15px]" />}
      aria-pressed={guided}
      onClick={() => (guided ? stopGuided() : startGuided())}
    >
      <span>Fill form</span>
      <span className="tabular rounded-xs bg-inset px-1 text-xs text-fg-secondary">
        {done}/{summary.total}
      </span>
    </Button>
  );
}

function AppMenu({ ready }: { ready: boolean }) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton label="More" size="lg">
          <MoreHorizontal />
        </IconButton>
      </MenuTrigger>
      <MenuContent>
        <MenuItem icon={<FolderOpen />} shortcut={shortcutLabel('mod+o')} onSelect={() => void openFromPicker()}>
          Open PDF…
        </MenuItem>
        {ready && (
          <MenuItem icon={<FileDown />} shortcut={shortcutLabel('mod+e')} onSelect={() => requestExport()}>
            Export PDF…
          </MenuItem>
        )}
        {ready && (
          <MenuItem icon={<X />} shortcut={shortcutLabel('mod+w')} onSelect={() => void closeDocument()}>
            Close document
          </MenuItem>
        )}
        <MenuSeparator />
        <MenuItem icon={<Keyboard />} shortcut="?" onSelect={() => ui().openDialog({ kind: 'shortcuts' })}>
          Keyboard shortcuts
        </MenuItem>
        <MenuItem icon={<Settings2 />} shortcut={shortcutLabel('mod+,')} onSelect={() => ui().openDialog({ kind: 'settings' })}>
          Settings
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
