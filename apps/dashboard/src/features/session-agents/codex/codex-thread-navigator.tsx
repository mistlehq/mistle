import {
  Button,
  OverflowTooltipText,
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Spinner,
} from "@mistle/ui";
import { ArrowClockwiseIcon, PlusIcon, XIcon } from "@phosphor-icons/react";

import { useDelayedMinimumVisibleFlag } from "../../shared/use-delayed-minimum-visible-flag.js";
import type { CodexThreadNavigatorRow } from "./codex-thread-navigator-model.js";

const ThreadOpeningIndicatorShowDelayMs = 120;
const ThreadOpeningIndicatorMinimumVisibleMs = 360;

export type CodexThreadNavigatorProps = {
  rows: readonly CodexThreadNavigatorRow[];
  isThreadListLimited: boolean;
  isStartingThread: boolean;
  onRefreshThreads: () => void;
  onSelectThread: (threadId: string) => void;
  onStartThread: () => void;
};

export function CodexThreadNavigator(input: CodexThreadNavigatorProps): React.JSX.Element {
  return (
    <aside
      aria-label="Threads"
      className="bg-background/98 hidden h-full min-h-0 w-64 shrink-0 flex-col border-r md:flex"
    >
      <CodexThreadNavigatorContent {...input} showHeader />
    </aside>
  );
}

export function CodexThreadNavigatorPanel(input: CodexThreadNavigatorProps): React.JSX.Element {
  return (
    <section aria-label="Threads" className="bg-background h-full min-h-0">
      <CodexThreadNavigatorContent {...input} showHeader />
    </section>
  );
}

export function CodexThreadNavigatorSheet(input: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  navigator: CodexThreadNavigatorProps;
}): React.JSX.Element {
  const sheetNavigator = {
    ...input.navigator,
    onSelectThread(threadId: string): void {
      input.onOpenChange(false);
      input.navigator.onSelectThread(threadId);
    },
    onStartThread(): void {
      input.onOpenChange(false);
      input.navigator.onStartThread();
    },
  } satisfies CodexThreadNavigatorProps;

  return (
    <Sheet onOpenChange={input.onOpenChange} open={input.isOpen}>
      <SheetContent
        className="!h-[100dvh] max-h-[100dvh] gap-0 p-0"
        showCloseButton={false}
        side="bottom"
      >
        <SheetHeader className="shrink-0 border-b px-4 py-3 text-left">
          <div className="flex min-w-0 items-center gap-2">
            <SheetTitle className="min-w-0 shrink truncate">Threads</SheetTitle>
            <CodexThreadNavigatorActions {...sheetNavigator} />
            <SheetClose
              render={
                <Button
                  aria-label="Close threads"
                  className="ml-auto"
                  size="icon-sm"
                  title="Close threads"
                  type="button"
                  variant="ghost"
                />
              }
            >
              <XIcon aria-hidden className="size-4" />
            </SheetClose>
          </div>
        </SheetHeader>
        <CodexThreadNavigatorContent {...sheetNavigator} showHeader={false} />
      </SheetContent>
    </Sheet>
  );
}

function CodexThreadNavigatorContent(
  input: CodexThreadNavigatorProps & {
    showHeader: boolean;
  },
): React.JSX.Element {
  const hasRows = input.rows.length > 0;
  const rowSections = groupRowsByCwd(input.rows);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {input.showHeader ? <CodexThreadNavigatorHeader {...input} /> : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {input.showHeader || !input.isThreadListLimited ? null : (
          <div className="text-muted-foreground px-2 pb-2 text-xs">Showing latest 20 only</div>
        )}
        {hasRows ? (
          <div className="space-y-3">
            {rowSections.map((section) => (
              <section key={section.key} aria-label={section.accessibleLabel}>
                {section.visibleLabel === null ? null : (
                  <div className="px-2 pb-1 text-[11px] font-medium text-muted-foreground">
                    {section.visibleLabel}
                  </div>
                )}
                <div className="space-y-1">
                  {section.rows.map((row) => (
                    <CodexThreadNavigatorRowView
                      key={`${row.isPinnedCurrent ? "pinned:" : ""}${row.id}`}
                      onSelectThread={input.onSelectThread}
                      row={row}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="px-2 py-8 text-center">
            <p className="text-muted-foreground text-sm">No threads.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function CodexThreadNavigatorHeader(input: CodexThreadNavigatorProps): React.JSX.Element {
  return (
    <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
      <div className="min-w-0">
        <h2 className="font-medium text-sm">Threads</h2>
        {input.isThreadListLimited ? (
          <div className="text-muted-foreground text-xs">Showing latest 20 only</div>
        ) : null}
      </div>
      <CodexThreadNavigatorActions {...input} />
    </div>
  );
}

function CodexThreadNavigatorActions(input: CodexThreadNavigatorProps): React.JSX.Element {
  return (
    <div className="flex items-center gap-1">
      <Button
        aria-label="Refresh threads"
        onClick={input.onRefreshThreads}
        size="icon-sm"
        title="Refresh threads"
        type="button"
        variant="ghost"
      >
        <ArrowClockwiseIcon aria-hidden className="size-4" />
      </Button>
      <Button
        aria-label="New thread"
        disabled={input.isStartingThread}
        onClick={input.onStartThread}
        size="icon-sm"
        title="New thread"
        type="button"
        variant="ghost"
      >
        <PlusIcon aria-hidden className="size-4" />
      </Button>
    </div>
  );
}

function groupRowsByCwd(rows: readonly CodexThreadNavigatorRow[]): readonly {
  cwd: string;
  accessibleLabel: string;
  key: string;
  visibleLabel: string | null;
  rows: readonly CodexThreadNavigatorRow[];
}[] {
  const sections: {
    accessibleLabel: string;
    cwd: string;
    key: string;
    visibleLabel: string | null;
    rows: CodexThreadNavigatorRow[];
  }[] = [];
  const sectionsByCwd = new Map<string, (typeof sections)[number]>();

  for (const row of rows) {
    if (row.isPinnedCurrent) {
      sections.push({
        accessibleLabel: row.title,
        cwd: row.cwd,
        key: `pinned:${row.id}`,
        visibleLabel: null,
        rows: [row],
      });
      continue;
    }

    const existingSection = sectionsByCwd.get(row.cwd);
    if (existingSection === undefined) {
      const section = {
        accessibleLabel: row.cwdSectionLabel,
        cwd: row.cwd,
        key: row.cwd,
        visibleLabel: row.cwdSectionLabel,
        rows: [row],
      };
      sections.push(section);
      sectionsByCwd.set(row.cwd, section);
      continue;
    }

    existingSection.rows.push(row);
  }

  return sections;
}

function CodexThreadNavigatorRowView(input: {
  row: CodexThreadNavigatorRow;
  onSelectThread: (threadId: string) => void;
}): React.JSX.Element {
  const row = input.row;
  const showOpeningIndicator = useDelayedMinimumVisibleFlag({
    active: row.isOpening,
    minimumVisibleMs: ThreadOpeningIndicatorMinimumVisibleMs,
    showDelayMs: ThreadOpeningIndicatorShowDelayMs,
  });

  return (
    <button
      aria-current={row.isActive ? "page" : undefined}
      className={`w-full rounded-md px-2 py-2 text-left transition-colors ${
        row.isActive
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
      }`}
      disabled={row.isOpening || showOpeningIndicator}
      onClick={() => input.onSelectThread(row.id)}
      title={row.cwd}
      type="button"
    >
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <OverflowTooltipText
              className={`min-w-0 text-[13px] leading-tight font-medium ${
                row.isPinnedCurrent ? "italic" : ""
              }`}
              text={row.title}
              tooltipSide="right"
              tooltipSideOffset={8}
            />
            <CodexThreadNavigatorRowIndicator
              row={row}
              showOpeningIndicator={showOpeningIndicator}
            />
          </div>
        </div>
      </div>
    </button>
  );
}

function CodexThreadNavigatorRowIndicator(input: {
  row: CodexThreadNavigatorRow;
  showOpeningIndicator: boolean;
}): React.JSX.Element | null {
  if (input.showOpeningIndicator) {
    return <Spinner aria-label="Opening thread" className="size-3.5 shrink-0" />;
  }

  if (input.row.pendingServerRequestCount > 0) {
    return (
      <span
        aria-label="Needs input"
        className="size-2 shrink-0 rounded-full bg-amber-500"
        role="status"
      />
    );
  }

  return null;
}
