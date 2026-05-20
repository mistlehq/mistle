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

import { formatCompactRelativeOrDate, formatDateTime } from "../../shared/date-formatters.js";
import { useDelayedMinimumVisibleFlag } from "../../shared/use-delayed-minimum-visible-flag.js";
import type { RuntimeConversationNavigatorRow } from "./runtime-conversation-navigator-model.js";

const ConversationOpeningIndicatorShowDelayMs = 120;
const ConversationOpeningIndicatorMinimumVisibleMs = 360;

export type RuntimeConversationNavigatorProps = {
  rows: readonly RuntimeConversationNavigatorRow[];
  isConversationListLimited: boolean;
  isStartingConversation: boolean;
  onRefreshConversations: () => void;
  onSelectConversation: (conversationId: string) => void;
  onStartConversation: () => void;
};

export function RuntimeConversationNavigator(
  input: RuntimeConversationNavigatorProps,
): React.JSX.Element {
  return (
    <aside
      aria-label="Conversations"
      className="bg-background/98 hidden h-full min-h-0 w-64 shrink-0 flex-col border-r md:flex"
    >
      <RuntimeConversationNavigatorContent {...input} showHeader />
    </aside>
  );
}

export function RuntimeConversationNavigatorPanel(
  input: RuntimeConversationNavigatorProps,
): React.JSX.Element {
  return (
    <section aria-label="Conversations" className="bg-background h-full min-h-0">
      <RuntimeConversationNavigatorContent {...input} showHeader />
    </section>
  );
}

export function RuntimeConversationNavigatorSheet(input: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  navigator: RuntimeConversationNavigatorProps;
}): React.JSX.Element {
  const sheetNavigator = {
    ...input.navigator,
    onSelectConversation(conversationId: string): void {
      input.onOpenChange(false);
      input.navigator.onSelectConversation(conversationId);
    },
    onStartConversation(): void {
      input.onOpenChange(false);
      input.navigator.onStartConversation();
    },
  } satisfies RuntimeConversationNavigatorProps;

  return (
    <Sheet onOpenChange={input.onOpenChange} open={input.isOpen}>
      <SheetContent
        className="!h-[100dvh] max-h-[100dvh] gap-0 p-0"
        showCloseButton={false}
        side="bottom"
      >
        <SheetHeader className="shrink-0 border-b px-4 py-3 text-left">
          <div className="flex min-w-0 items-center gap-2">
            <SheetTitle className="min-w-0 shrink truncate">Conversations</SheetTitle>
            <RuntimeConversationNavigatorActions {...sheetNavigator} />
            <SheetClose
              render={
                <Button
                  aria-label="Close conversations"
                  className="ml-auto"
                  size="icon-sm"
                  title="Close conversations"
                  type="button"
                  variant="ghost"
                />
              }
            >
              <XIcon aria-hidden className="size-4" />
            </SheetClose>
          </div>
        </SheetHeader>
        <RuntimeConversationNavigatorContent {...sheetNavigator} showHeader={false} />
      </SheetContent>
    </Sheet>
  );
}

function RuntimeConversationNavigatorContent(
  input: RuntimeConversationNavigatorProps & {
    showHeader: boolean;
  },
): React.JSX.Element {
  const hasRows = input.rows.length > 0;
  const rowSections = groupRowsByCwd(input.rows);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {input.showHeader ? <RuntimeConversationNavigatorHeader {...input} /> : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {input.showHeader || !input.isConversationListLimited ? null : (
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
                    <RuntimeConversationNavigatorRowView
                      key={`${row.isPinnedCurrent ? "pinned:" : ""}${row.id}`}
                      onSelectConversation={input.onSelectConversation}
                      row={row}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="px-2 py-8 text-center">
            <p className="text-muted-foreground text-sm">No conversations.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function RuntimeConversationNavigatorHeader(
  input: RuntimeConversationNavigatorProps,
): React.JSX.Element {
  return (
    <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
      <div className="min-w-0">
        <h2 className="font-medium text-sm">Conversations</h2>
        {input.isConversationListLimited ? (
          <div className="text-muted-foreground text-xs">Showing latest 20 only</div>
        ) : null}
      </div>
      <RuntimeConversationNavigatorActions {...input} />
    </div>
  );
}

function RuntimeConversationNavigatorActions(
  input: RuntimeConversationNavigatorProps,
): React.JSX.Element {
  return (
    <div className="flex items-center gap-1">
      <Button
        aria-label="Refresh conversations"
        onClick={input.onRefreshConversations}
        size="icon-sm"
        title="Refresh conversations"
        type="button"
        variant="ghost"
      >
        <ArrowClockwiseIcon aria-hidden className="size-4" />
      </Button>
      <Button
        aria-label="New conversation"
        disabled={input.isStartingConversation}
        onClick={input.onStartConversation}
        size="icon-sm"
        title="New conversation"
        type="button"
        variant="ghost"
      >
        <PlusIcon aria-hidden className="size-4" />
      </Button>
    </div>
  );
}

function groupRowsByCwd(rows: readonly RuntimeConversationNavigatorRow[]): readonly {
  accessibleLabel: string;
  key: string;
  visibleLabel: string | null;
  rows: readonly RuntimeConversationNavigatorRow[];
}[] {
  const sections: {
    accessibleLabel: string;
    key: string;
    visibleLabel: string | null;
    rows: RuntimeConversationNavigatorRow[];
  }[] = [];
  const sectionsByCwd = new Map<string, (typeof sections)[number]>();

  for (const row of rows) {
    if (row.isPinnedCurrent) {
      sections.push({
        accessibleLabel: row.title,
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

function RuntimeConversationNavigatorRowView(input: {
  row: RuntimeConversationNavigatorRow;
  onSelectConversation: (conversationId: string) => void;
}): React.JSX.Element {
  const row = input.row;
  const activity = resolveConversationActivityDisplay(row.lastActivityAt);
  const showOpeningIndicator = useDelayedMinimumVisibleFlag({
    active: row.isOpening,
    minimumVisibleMs: ConversationOpeningIndicatorMinimumVisibleMs,
    showDelayMs: ConversationOpeningIndicatorShowDelayMs,
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
      onClick={() => input.onSelectConversation(row.id)}
      title={row.cwd}
      type="button"
    >
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <OverflowTooltipText
                className={`min-w-0 text-[13px] leading-tight font-medium ${
                  row.isPinnedCurrent ? "italic" : ""
                }`}
                text={row.title}
                tooltipSide="right"
                tooltipSideOffset={8}
              />
              {row.isOriginal ? (
                <span className="shrink-0 text-[11px] leading-tight text-muted-foreground">
                  (original)
                </span>
              ) : null}
              <RuntimeConversationNavigatorRowIndicator
                pendingServerRequestCount={row.pendingServerRequestCount}
                showOpeningIndicator={showOpeningIndicator}
              />
            </div>
            {activity === null ? null : (
              <span
                className="shrink-0 pt-px text-[11px] leading-tight text-muted-foreground"
                title={activity.title}
              >
                {activity.label}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

function RuntimeConversationNavigatorRowIndicator(input: {
  pendingServerRequestCount: number;
  showOpeningIndicator: boolean;
}): React.JSX.Element | null {
  if (input.showOpeningIndicator) {
    return <Spinner aria-label="Opening conversation" className="size-3.5 shrink-0" />;
  }

  if (input.pendingServerRequestCount > 0) {
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

function resolveConversationActivityDisplay(
  lastActivityAt: number | null,
): { label: string; title: string } | null {
  if (lastActivityAt === null) {
    return null;
  }

  const isoDateTime = new Date(lastActivityAt).toISOString();
  return {
    label: formatCompactRelativeOrDate(isoDateTime),
    title: `Last activity ${formatDateTime(isoDateTime)}`,
  };
}
