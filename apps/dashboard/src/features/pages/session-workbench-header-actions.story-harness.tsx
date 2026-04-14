import { useState } from "react";

import { SessionWorkbenchStoryChrome } from "./session-story-support.js";
import {
  SessionWorkbenchHeaderActions,
  type SessionWorkbenchHeaderRepositoryOption,
} from "./session-workbench-header-actions.js";

type StoryStatus = "connected" | "not_connected";

type SessionWorkbenchHeaderActionsStoryHarnessProps = {
  repositoryErrorMessage?: string;
  repositoryIsRefreshing?: boolean;
  repositoryOpen?: boolean;
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
  const [selectedRepositoryValue, setSelectedRepositoryValue] = useState<string | null>(
    input.repositorySelectedValue ?? null,
  );

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
          ...(input.repositoryOpen === undefined ? {} : { open: input.repositoryOpen }),
          onValueChange: setSelectedRepositoryValue,
          options: input.repositoryOptions,
          selectedValue: selectedRepositoryValue,
        };

  return (
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
  );
}

export type { SessionWorkbenchHeaderActionsStoryHarnessProps };
