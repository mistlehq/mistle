import type { ProcessEntry } from "@mistle/sandbox-session-protocol";
import { useEffect, useRef, useState } from "react";

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
  className: "bg-transparent text-foreground shadow-none hover:bg-stone-100",
  disabled: false,
  onClick: () => {
    return;
  },
  pressed: false,
} as const;

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
  kind: "connected" | "not_connected";
  label: string;
} {
  return {
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
    </div>
  );
}

export type { SessionWorkbenchHeaderActionsStoryHarnessProps };
