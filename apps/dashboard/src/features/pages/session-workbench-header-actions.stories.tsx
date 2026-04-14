import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useRef, useState } from "react";

import { SessionWorkbenchStoryChrome } from "./session-story-support.js";
import {
  SessionWorkbenchHeaderActions,
  type SessionWorkbenchHeaderRepositoryOption,
} from "./session-workbench-header-actions.js";

const StoryRepositoryOptions = [
  { value: "__none__", label: "None" },
  { value: "/root/mistle", label: "mistle" },
  { value: "/root/mistle-docs", label: "mistle-docs" },
  { value: "/root/platform", label: "platform" },
] satisfies ReadonlyArray<SessionWorkbenchHeaderRepositoryOption>;

const meta = {
  title: "Dashboard/Sessions/SessionWorkbench/HeaderActions",
  component: SessionWorkbenchHeaderActions,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof SessionWorkbenchHeaderActions>;

export default meta;

type Story = StoryObj<typeof meta>;
type StoryStatus = "connected" | "not_connected";
type StoryHeaderActionsInput = {
  repositoryErrorMessage?: string;
  interactiveRefresh?: boolean;
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

const StorybookArgs = {
  cliControl: {
    ...StoryActionButtonControl,
    ariaLabel: "CLI",
    title: "Open Codex CLI",
  },
  diffControl: {
    ...StoryActionButtonControl,
    ariaLabel: "Open changes",
    title: "Open changes",
  },
  status: {
    kind: "not_connected" as const,
    label: "Not connected",
  },
  terminalControl: {
    ...StoryActionButtonControl,
    ariaLabel: "Open terminal",
    title: "Open terminal",
  },
} satisfies NonNullable<Story["args"]>;

function createHeaderStatus(status: StoryStatus): {
  kind: "connected" | "not_connected";
  label: string;
} {
  return {
    kind: status,
    label: status === "connected" ? "Connected" : "Not connected",
  };
}

function StoryHeaderActions(input: StoryHeaderActionsInput): React.JSX.Element {
  const refreshAnimationFrameRef = useRef<number | null>(null);
  const refreshNestedAnimationFrameRef = useRef<number | null>(null);
  const [repositoryOptions, setRepositoryOptions] = useState(input.repositoryOptions ?? undefined);
  const [selectedRepositoryValue, setSelectedRepositoryValue] = useState<string | null>(
    input.repositorySelectedValue ?? null,
  );
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    setRepositoryOptions(input.repositoryOptions ?? undefined);
  }, [input.repositoryOptions]);

  useEffect(() => {
    return () => {
      if (refreshAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(refreshAnimationFrameRef.current);
      }

      if (refreshNestedAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(refreshNestedAnimationFrameRef.current);
      }
    };
  }, []);

  const repositoryControl =
    repositoryOptions === undefined
      ? undefined
      : {
          ariaLabel: "Primary repository",
          ...(input.repositoryDisabled === undefined ? {} : { disabled: input.repositoryDisabled }),
          ...(input.repositoryErrorMessage === undefined
            ? {}
            : { errorMessage: input.repositoryErrorMessage }),
          ...(isRefreshing ? { isRefreshing: true } : {}),
          ...(input.interactiveRefresh
            ? {
                onOpenChange: (open: boolean) => {
                  if (!open) {
                    return;
                  }

                  setIsRefreshing(true);
                  if (refreshAnimationFrameRef.current !== null) {
                    window.cancelAnimationFrame(refreshAnimationFrameRef.current);
                  }

                  if (refreshNestedAnimationFrameRef.current !== null) {
                    window.cancelAnimationFrame(refreshNestedAnimationFrameRef.current);
                  }

                  refreshAnimationFrameRef.current = window.requestAnimationFrame(() => {
                    refreshNestedAnimationFrameRef.current = window.requestAnimationFrame(() => {
                      setRepositoryOptions((currentOptions) => {
                        if (currentOptions === undefined) {
                          return currentOptions;
                        }

                        const alreadyPresent = currentOptions.some(
                          (option) => option.value === "/root/mistle-temp-docs",
                        );
                        if (alreadyPresent) {
                          return currentOptions;
                        }

                        return [
                          ...currentOptions,
                          { value: "/root/mistle-temp-docs", label: "mistle-temp-docs" },
                        ];
                      });
                      setIsRefreshing(false);
                      refreshAnimationFrameRef.current = null;
                      refreshNestedAnimationFrameRef.current = null;
                    });
                  });
                },
              }
            : {}),
          onValueChange: setSelectedRepositoryValue,
          options: repositoryOptions,
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

function createStory(input: StoryHeaderActionsInput): Story {
  return {
    args: StorybookArgs,
    render: () => <StoryHeaderActions {...input} />,
  };
}

export const Default = createStory({
  interactiveRefresh: true,
  repositoryOptions: StoryRepositoryOptions,
  repositorySelectedValue: "/root/mistle",
  status: "connected",
});

export const WithRepositorySelectorDisabled = createStory({
  repositoryDisabled: true,
  repositoryOptions: StoryRepositoryOptions,
  repositorySelectedValue: "/root/mistle",
  status: "connected",
});

export const WithRepositorySelectorError = createStory({
  repositoryErrorMessage: "The selected repository is no longer available in this sandbox.",
  repositoryOptions: StoryRepositoryOptions,
  repositorySelectedValue: "/root/platform",
  status: "connected",
});
