import { FileText, FolderOpen, Lock, MoreHorizontal, Sparkles } from 'lucide-react';
import { openFromPicker, openPicked } from '@/app/documentActions';
import { forgetRecent, reopenRecent, useRecents, type RecentDocument } from '@/app/sessions';
import { BRAND } from '@/brand';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/Menu';
import { platform } from '@/platform';
import { toast } from '@/state/feedback';
import { loadSampleForm, SAMPLE_NAME } from './sample';
import { LogoMark } from './LogoMark';
import { shortcutLabel } from './shortcuts';

export function EmptyState({ dragging }: { dragging: boolean }) {
  const recents = useRecents((s) => s.items);
  const loaded = useRecents((s) => s.loaded);
  const desktop = platform().canOpenPaths;
  const usable = recents.filter((r) => desktop ? !!r.path : r.cached);

  return (
    <div className="flex h-full min-h-0 overflow-auto bg-canvas">
      <div className="m-auto flex w-full max-w-[920px] flex-col items-stretch gap-8 px-8 py-12 md:flex-row md:items-start">
        <section className="flex flex-1 flex-col">
          <LogoMark className="mb-5 size-10" />
          <h2 className="text-2xl font-semibold tracking-[-0.02em] text-fg">Fill in a PDF form</h2>
          <p className="mt-1.5 max-w-[42ch] text-lg leading-[1.45] text-fg-secondary">{BRAND.tagline}</p>

          <DropZone dragging={dragging} />

          <div className="mt-4 flex items-center gap-2 text-xs text-fg-tertiary">
            <Lock className="size-3.5" />
            Files are processed on this device. Nothing is uploaded.
          </div>
        </section>

        <aside className="w-full shrink-0 md:w-[300px] md:pt-[68px]" aria-label="Recent documents">
          <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">Recent</h3>
          {!loaded ? (
            <div className="space-y-1.5">
              {[0, 1, 2].map((i) => (
                <div key={i} className="ff-skeleton h-[58px] rounded-md" />
              ))}
            </div>
          ) : usable.length === 0 ? (
            <p className="rounded-md border border-dashed border-line-strong px-4 py-5 text-sm text-fg-tertiary">
              Documents you open appear here, with your progress saved.
            </p>
          ) : (
            <ul className="space-y-1">
              {usable.map((r) => (
                <RecentRow key={r.hash} r={r} />
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}

function DropZone({ dragging }: { dragging: boolean }) {
  return (
    <div
      className={
        'mt-7 flex flex-col items-center justify-center gap-4 rounded-lg border-[1.5px] border-dashed px-6 py-12 text-center transition-[background-color,border-color] duration-150 ' +
        (dragging ? 'border-accent bg-accent-softer' : 'border-line-strong bg-elevated/50')
      }
    >
      <div className={'flex size-11 items-center justify-center rounded-full ' + (dragging ? 'bg-accent text-fg-on-accent' : 'bg-inset text-fg-secondary')}>
        <FileText className="size-5 stroke-[1.75]" />
      </div>
      <div>
        <p className="text-md font-medium text-fg">{dragging ? 'Drop to open' : 'Drop a PDF here'}</p>
        <p className="mt-0.5 text-sm text-fg-tertiary">or choose one from your computer</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button variant="primary" size="lg" icon={<FolderOpen className="size-4" />} onClick={() => void openFromPicker()} data-testid="open-pdf">
          Open PDF…
          <span className="ml-1 text-xs font-normal opacity-70">{shortcutLabel('mod+o')}</span>
        </Button>
        <Button
          variant="ghost"
          size="lg"
          icon={<Sparkles className="size-4" />}
          onClick={async () => {
            try {
              await openPicked(await loadSampleForm());
            } catch {
              toast({ tone: 'danger', title: 'The sample form couldn’t be created.' });
            }
          }}
        >
          Try a sample form
        </Button>
      </div>
    </div>
  );
}

function RecentRow({ r }: { r: RecentDocument }) {
  const open = async () => {
    try {
      const picked = await reopenRecent(r);
      if (!picked) {
        toast({ tone: 'warning', title: 'File not available', body: `“${r.name}” can no longer be opened from here. Open it again from disk.` });
        return;
      }
      await openPicked(picked);
    } catch {
      toast({
        tone: 'warning',
        title: `Couldn’t reopen “${r.name}”`,
        body: 'It may have been moved or deleted.',
        action: { label: 'Remove from recents', run: () => void forgetRecent(r.hash) },
      });
    }
  };
  return (
    <li className="group relative">
      <button
        type="button"
        onClick={() => void open()}
        className="flex w-full items-center gap-3 rounded-md p-1.5 pr-9 text-left hover:bg-hover"
      >
        <div className="flex h-[46px] w-[36px] shrink-0 items-center justify-center overflow-hidden rounded-[3px] bg-white shadow-[0_0_0_1px_rgb(16_16_20/0.08),0_1px_2px_rgb(16_16_20/0.08)]">
          {r.thumbnail ? <img src={r.thumbnail} alt="" className="size-full object-cover object-top" /> : <FileText className="size-4 text-fg-disabled" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-fg">{r.name === SAMPLE_NAME ? 'Sample: Rental application' : r.name}</div>
          <div className="truncate text-xs text-fg-tertiary">
            {r.pageCount} {r.pageCount === 1 ? 'page' : 'pages'} · {relativeTime(r.openedAt)}
          </div>
        </div>
      </button>
      <div className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <Menu>
          <MenuTrigger asChild>
            <IconButton label="Options" size="sm">
              <MoreHorizontal />
            </IconButton>
          </MenuTrigger>
          <MenuContent>
            <MenuItem onSelect={() => void forgetRecent(r.hash)}>Remove from recents</MenuItem>
          </MenuContent>
        </Menu>
      </div>
    </li>
  );
}

function relativeTime(t: number): string {
  const diff = Date.now() - t;
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return d === 1 ? 'yesterday' : `${d} days ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
