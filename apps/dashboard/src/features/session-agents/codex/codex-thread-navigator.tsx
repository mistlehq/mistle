import { Button, ButtonGroup, ButtonGroupText, OverflowTooltipText } from "@mistle/ui";
import { PlusIcon } from "@phosphor-icons/react";

import type {
  CodexThreadNavigatorRow,
  CodexThreadNavigatorScope,
} from "./codex-thread-navigator-model.js";

export function CodexThreadNavigator(input: {
  rows: readonly CodexThreadNavigatorRow[];
  scope: CodexThreadNavigatorScope;
  canUseRepositoryScope: boolean;
  isStartingThread: boolean;
  onRefreshThreads: () => void;
  onScopeChange: (scope: CodexThreadNavigatorScope) => void;
  onSelectThread: (threadId: string) => void;
  onStartThread: () => void;
}): React.JSX.Element {
  const hasRows = input.rows.length > 0;

  return (
    <aside
      aria-label="Threads"
      className="bg-background/98 hidden h-full min-h-0 w-64 shrink-0 flex-col border-r md:flex"
    >
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
        <h2 className="font-medium text-sm">Threads</h2>
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

      <div className="shrink-0 border-b px-3 py-2">
        <div aria-label="Thread scope" className="grid grid-cols-2 rounded-md border p-0.5">
          <button
            aria-pressed={input.canUseRepositoryScope && input.scope === "repository"}
            className={`rounded-sm px-2 py-1 text-xs font-medium ${
              input.canUseRepositoryScope && input.scope === "repository"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            }`}
            disabled={!input.canUseRepositoryScope}
            onClick={() => input.onScopeChange("repository")}
            type="button"
          >
            Repository
          </button>
          <button
            aria-pressed={!input.canUseRepositoryScope || input.scope === "all"}
            className={`rounded-sm px-2 py-1 text-xs font-medium ${
              !input.canUseRepositoryScope || input.scope === "all"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            }`}
            onClick={() => input.onScopeChange("all")}
            type="button"
          >
            All
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {hasRows ? (
          <div className="space-y-1">
            {input.rows.map((row) => (
              <CodexThreadNavigatorRowView
                key={`${row.isPinnedCurrent ? "pinned:" : ""}${row.id}`}
                onSelectThread={input.onSelectThread}
                row={row}
              />
            ))}
          </div>
        ) : (
          <div className="px-2 py-8 text-center">
            <p className="text-muted-foreground text-sm">No threads in this scope.</p>
            {input.scope === "repository" ? (
              <Button
                className="mt-3"
                onClick={() => input.onScopeChange("all")}
                size="sm"
                type="button"
                variant="outline"
              >
                View all threads
              </Button>
            ) : null}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t p-2">
        <ButtonGroup className="w-full">
          <ButtonGroupText className="min-w-0 flex-1 justify-start text-muted-foreground text-xs">
            Latest 20
          </ButtonGroupText>
          <Button onClick={input.onRefreshThreads} size="sm" type="button" variant="ghost">
            Refresh
          </Button>
        </ButtonGroup>
      </div>
    </aside>
  );
}

function CodexThreadNavigatorRowView(input: {
  row: CodexThreadNavigatorRow;
  onSelectThread: (threadId: string) => void;
}): React.JSX.Element {
  const row = input.row;
  const rowStateLabel = row.isOpening
    ? "Opening"
    : row.isActive
      ? "Active"
      : row.isLoaded
        ? "Loaded"
        : null;

  return (
    <button
      aria-current={row.isActive ? "page" : undefined}
      className={`w-full rounded-md px-2 py-2 text-left transition-colors ${
        row.isActive
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
      }`}
      disabled={row.isOpening}
      onClick={() => input.onSelectThread(row.id)}
      title={row.cwd}
      type="button"
    >
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <OverflowTooltipText
            className="min-w-0 text-[13px] leading-tight font-medium"
            text={row.title}
            tooltipSide="right"
            tooltipSideOffset={8}
          />
          <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] leading-tight">
            {rowStateLabel === null ? null : (
              <span className="shrink-0 rounded-sm bg-primary/10 px-1 py-0.5 font-medium text-primary">
                {rowStateLabel}
              </span>
            )}
            {row.isPinnedCurrent ? (
              <span className="shrink-0 rounded-sm bg-muted px-1 py-0.5 font-medium text-muted-foreground">
                Current
              </span>
            ) : null}
            {row.cwdLabel === null ? null : (
              <span className="min-w-0 truncate" title={row.cwd}>
                {row.cwdLabel}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}
