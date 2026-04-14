import { useEffect, useRef, useState } from "react";

import { SessionWorkbenchStoryChrome } from "./session-story-support.js";
import {
  SessionWorkbenchHeaderActions,
  type SessionWorkbenchHeaderRepositoryOption,
} from "./session-workbench-header-actions.js";

type StoryStatus = "connected" | "not_connected";

type SessionWorkbenchHeaderActionsStoryHarnessProps = {
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

function createHeaderStatus(status: StoryStatus): {
  kind: "connected" | "not_connected";
  label: string;
} {
  return {
    kind: status,
    label: status === "connected" ? "Connected" : "Not connected",
  };
}

export function SessionWorkbenchHeaderActionsStoryHarness(
  input: SessionWorkbenchHeaderActionsStoryHarnessProps,
): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const openAnimationFrameRef = useRef<number | null>(null);
  const hasOpenedRef = useRef(false);
  const [selectedRepositoryValue, setSelectedRepositoryValue] = useState<string | null>(
    input.repositorySelectedValue ?? null,
  );

  useEffect(() => {
    if (!input.repositoryStartsOpen || hasOpenedRef.current) {
      return;
    }

    openAnimationFrameRef.current = window.requestAnimationFrame(() => {
      const trigger = rootRef.current?.querySelector<HTMLButtonElement>('[role="combobox"]');
      trigger?.click();
      hasOpenedRef.current = true;
      openAnimationFrameRef.current = null;
    });

    return () => {
      if (openAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(openAnimationFrameRef.current);
      }
    };
  }, [input.repositoryStartsOpen]);

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

  return (
    <div ref={rootRef}>
      <SessionWorkbenchStoryChrome
        headerActions={
          <SessionWorkbenchHeaderActions
            cliControl={{
              ...StoryActionButtonControl,
              ariaLabel: "CLI",
              className: StoryActionButtonControl.className,
              title: "Open Codex CLI",
            }}
            diffControl={{
              ...StoryActionButtonControl,
              ariaLabel: "Open changes",
              className: StoryActionButtonControl.className,
              title: "Open changes",
            }}
            {...(repositoryControl === undefined ? {} : { repositoryControl })}
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
