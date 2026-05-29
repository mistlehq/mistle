import type { ProcessEntry } from "@mistle/sandbox-session-protocol";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@mistle/ui";
import { useEffect, useRef, useState } from "react";

import { SessionDiffPanel } from "./session-diff-panel.js";
import { SessionPortAccessPopover, SessionPortAccessSheet } from "./session-port-access-popover.js";
import { SessionWorkbenchStoryChrome } from "./session-story-support.js";
import {
  SessionWorkbenchHeaderActions,
  type SessionWorkbenchHeaderRepositoryOption,
} from "./session-workbench-header-actions.js";
import type { SessionPortAccessState } from "./use-session-port-access.js";

type StoryStatus = "connected" | "not_connected";

type SessionWorkbenchHeaderActionsStoryHarnessProps = {
  moreActionsStartsOpen?: boolean;
  portAccessProcessScenario?: "default" | "many";
  portAccessStartsOpen?: boolean;
  repositoryErrorMessage?: string;
  repositoryIsRefreshing?: boolean;
  repositoryStartsOpen?: boolean;
  repositoryOptions?: ReadonlyArray<SessionWorkbenchHeaderRepositoryOption>;
  repositorySelectedValue?: string | null;
  repositoryDisabled?: boolean;
  status: StoryStatus;
};

const StoryActionButtonControl = {
  className: "bg-transparent text-foreground shadow-none hover:bg-muted/60",
  disabled: false,
  onClick: () => {
    return;
  },
  pressed: false,
} satisfies Pick<
  React.ComponentProps<typeof SessionWorkbenchHeaderActions>["cliControl"],
  "className" | "disabled" | "onClick" | "pressed"
>;

const StoryDiffPatch = [
  "diff --git a/apps/dashboard/src/features/pages/session-workbench-header-actions.tsx b/apps/dashboard/src/features/pages/session-workbench-header-actions.tsx",
  "index 96a64a1..b47f1d8 100644",
  "--- a/apps/dashboard/src/features/pages/session-workbench-header-actions.tsx",
  "+++ b/apps/dashboard/src/features/pages/session-workbench-header-actions.tsx",
  "@@ -1,5 +1,6 @@",
  ' import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@mistle/ui";',
  '+import { DotsThreeIcon } from "@phosphor-icons/react";',
  " ",
  " type SessionWorkbenchHeaderMobilePortAccessControl = {",
  "+  disabled: boolean;",
  "+  onOpen: () => void;",
  "+  surface: React.ReactNode;",
  "+  title: string;",
  " };",
  "@@ -38,6 +44,7 @@ export function SessionWorkbenchHeaderActions(input: {",
  "   cliControl: SessionWorkbenchHeaderButtonControl;",
  "   diffControl: SessionWorkbenchHeaderButtonControl;",
  "+  mobilePortAccessControl?: SessionWorkbenchHeaderMobilePortAccessControl;",
  "   portAccessControl?: React.ReactNode;",
  "   terminalControl: SessionWorkbenchHeaderButtonControl;",
  " }): React.JSX.Element {",
  "@@ -86,6 +93,19 @@ export function SessionWorkbenchHeaderActions(input: {",
  '       <Button aria-label="TUI">TUI</Button>',
  "       {desktopPortAccessControl}",
  "+      <DropdownMenu>",
  "+        <DropdownMenuTrigger",
  '+          render={<Button aria-label="Open session tools" size="icon-sm" />}',
  "+        >",
  '+          <DotsThreeIcon className="size-5" />',
  "+        </DropdownMenuTrigger>",
  "+        <DropdownMenuContent>",
  "+          {mobilePortAccessControl === null ? null : (",
  '+          <DropdownMenuItem aria-label="Processes" onClick={mobilePortAccessControl.onOpen}>',
  "+            Processes",
  "+          </DropdownMenuItem>",
  "+          )}",
  "+        </DropdownMenuContent>",
  "+      </DropdownMenu>",
  "+      {mobilePortAccessControl?.surface}",
  "     </div>",
  "   );",
  " }",
].join("\n");

const StoryProcesses: ProcessEntry[] = [
  {
    pid: 6402,
    command: "node server.js",
    listeners: [
      {
        bindAddress: "127.0.0.1",
        port: 3000,
      },
      {
        bindAddress: "::1",
        port: 3000,
      },
    ],
  },
  {
    pid: 4321,
    command: "vite dev --host 127.0.0.1 --port 5173",
    listeners: [
      {
        bindAddress: "127.0.0.1",
        port: 5173,
      },
    ],
  },
];

const StoryManyProcesses: ProcessEntry[] = Array.from(
  {
    length: 24,
  },
  (_, index): ProcessEntry => {
    const port = 3000 + index;
    return {
      pid: 7000 + index,
      command: createStoryProcessCommand(index, port),
      listeners: [
        {
          bindAddress: "127.0.0.1",
          port,
        },
      ],
    };
  },
);

function createHeaderStatus(status: StoryStatus): {
  indicatorClassName: string;
  kind: "connected" | "not_connected";
  label: string;
} {
  return {
    indicatorClassName:
      status === "connected"
        ? "border-emerald-700 bg-emerald-600"
        : "border-muted-foreground/30 bg-muted-foreground/30",
    kind: status,
    label: status === "connected" ? "Connected" : "Not connected",
  };
}

function createStoryProcessCommand(index: number, port: number): string {
  const commandByIndex = [
    `node server-${String(index + 1)}.js --port ${String(port)}`,
    `vite dev --host 127.0.0.1 --port ${String(port)}`,
    `python -m http.server ${String(port)}`,
    `storybook dev -p ${String(port)}`,
  ];
  return commandByIndex[index % commandByIndex.length] ?? `server --port ${String(port)}`;
}

export function SessionWorkbenchHeaderActionsStoryHarness(
  input: SessionWorkbenchHeaderActionsStoryHarnessProps,
): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const repositoryOpenAnimationFrameRef = useRef<number | null>(null);
  const moreActionsOpenAnimationFrameRef = useRef<number | null>(null);
  const hasOpenedRepositoryRef = useRef(false);
  const hasOpenedMoreActionsRef = useRef(false);
  const [selectedRepositoryValue, setSelectedRepositoryValue] = useState<string | null>(
    input.repositorySelectedValue ?? null,
  );
  const [isPortAccessPanelOpen, setPortAccessPanelOpen] = useState(
    input.portAccessStartsOpen ?? false,
  );
  const [isDiffSheetOpen, setDiffSheetOpen] = useState(false);

  useEffect(() => {
    if (!input.repositoryStartsOpen || hasOpenedRepositoryRef.current) {
      return;
    }

    repositoryOpenAnimationFrameRef.current = window.requestAnimationFrame(() => {
      const trigger = rootRef.current?.querySelector<HTMLButtonElement>('[role="combobox"]');
      trigger?.click();
      hasOpenedRepositoryRef.current = true;
      repositoryOpenAnimationFrameRef.current = null;
    });

    return () => {
      if (repositoryOpenAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(repositoryOpenAnimationFrameRef.current);
      }
    };
  }, [input.repositoryStartsOpen]);

  useEffect(() => {
    if (!input.moreActionsStartsOpen || hasOpenedMoreActionsRef.current) {
      return;
    }

    moreActionsOpenAnimationFrameRef.current = window.requestAnimationFrame(() => {
      const trigger = rootRef.current?.querySelector<HTMLButtonElement>(
        'button[aria-label="Open session tools"]',
      );
      trigger?.click();
      hasOpenedMoreActionsRef.current = true;
      moreActionsOpenAnimationFrameRef.current = null;
    });

    return () => {
      if (moreActionsOpenAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(moreActionsOpenAnimationFrameRef.current);
      }
    };
  }, [input.moreActionsStartsOpen]);

  const repositoryControl =
    input.repositoryOptions === undefined
      ? undefined
      : {
          ariaLabel: "Primary repository",
          ...(input.repositoryDisabled === undefined ? {} : { disabled: input.repositoryDisabled }),
          ...(input.repositoryErrorMessage === undefined
            ? {}
            : { errorMessage: input.repositoryErrorMessage }),
          ...(input.repositoryIsRefreshing ? { isRefreshing: true } : {}),
          onValueChange: setSelectedRepositoryValue,
          options: input.repositoryOptions,
          selectedValue: selectedRepositoryValue,
        };
  const portAccessProcesses =
    input.portAccessProcessScenario === "many" ? StoryManyProcesses : StoryProcesses;
  const portAccessState = {
    buttonDisabledReason: null,
    errorMessage: null,
    isLoadingProcesses: false,
    isOpeningProcessKey: null,
    isPanelOpen: isPortAccessPanelOpen,
    observedAt: null,
    openProcess: async () => {
      return;
    },
    processes: portAccessProcesses,
    setPanelOpen: setPortAccessPanelOpen,
  } satisfies SessionPortAccessState;

  return (
    <div ref={rootRef}>
      <SessionWorkbenchStoryChrome
        headerActions={
          <SessionWorkbenchHeaderActions
            cliControl={{
              ...StoryActionButtonControl,
              ariaLabel: "TUI",
              className: StoryActionButtonControl.className,
              title: "Open Codex TUI",
            }}
            diffControl={{
              ...StoryActionButtonControl,
              ariaLabel: "Open changes",
              className: StoryActionButtonControl.className,
              onClick: () => {
                setDiffSheetOpen(true);
              },
              title: "Open changes",
            }}
            {...(repositoryControl === undefined ? {} : { repositoryControl })}
            mobilePortAccessControl={{
              disabled: portAccessState.buttonDisabledReason !== null,
              onOpen: () => {
                portAccessState.setPanelOpen(true);
              },
              surface: <SessionPortAccessSheet state={portAccessState} />,
              title: portAccessState.buttonDisabledReason ?? "Show running processes",
            }}
            portAccessControl={<SessionPortAccessPopover state={portAccessState} />}
            status={createHeaderStatus(input.status)}
            terminalControl={{
              ...StoryActionButtonControl,
              ariaLabel: "Open terminal",
              className: StoryActionButtonControl.className,
              title: "Open terminal",
            }}
          />
        }
      >
        <div className="flex h-full items-center justify-center bg-background">
          <div className="rounded-xl border bg-card px-6 py-10 shadow-xs">
            Session workbench header preview
          </div>
        </div>
      </SessionWorkbenchStoryChrome>
      <Sheet onOpenChange={setDiffSheetOpen} open={isDiffSheetOpen}>
        <SheetContent
          className="!h-[100dvh] max-h-[100dvh] gap-0 overflow-hidden p-0"
          side="bottom"
        >
          <SheetHeader className="shrink-0 border-b px-4 py-3 pr-12 text-left">
            <SheetTitle>Changes</SheetTitle>
            <SheetDescription>Review the file changes from this session.</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-hidden">
            <SessionDiffPanel
              patch={StoryDiffPatch}
              repositoryPath="/workspace/mistle"
              summaryLabel="Compared with origin/main"
              title="Current changes"
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

export type { SessionWorkbenchHeaderActionsStoryHarnessProps };
