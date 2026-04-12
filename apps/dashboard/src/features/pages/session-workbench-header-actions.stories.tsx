import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

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
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof SessionWorkbenchHeaderActions>;

export default meta;

type Story = StoryObj<typeof meta>;

function StoryHeaderActions(input: {
  repositoryOptions?: ReadonlyArray<SessionWorkbenchHeaderRepositoryOption>;
  repositorySelectedValue?: string | null;
  repositoryDisabled?: boolean;
  status: "connected" | "error" | "not_connected";
}): React.JSX.Element {
  const [selectedRepositoryValue, setSelectedRepositoryValue] = useState<string | null>(
    input.repositorySelectedValue ?? null,
  );

  return (
    <SessionWorkbenchStoryChrome
      headerActions={
        <SessionWorkbenchHeaderActions
          cliControl={{
            ariaLabel: "CLI",
            className: "bg-transparent text-foreground shadow-none hover:bg-stone-100",
            disabled: false,
            onClick: () => {
              return;
            },
            pressed: false,
            title: "Open Codex CLI",
          }}
          diffControl={{
            ariaLabel: "Open changes",
            className: "bg-transparent text-foreground shadow-none hover:bg-stone-100",
            disabled: false,
            onClick: () => {
              return;
            },
            pressed: false,
            title: "Open changes",
          }}
          {...(input.repositoryOptions === undefined
            ? {}
            : {
                repositoryControl: {
                  ariaLabel: "Primary repository",
                  ...(input.repositoryDisabled === undefined
                    ? {}
                    : { disabled: input.repositoryDisabled }),
                  onValueChange: setSelectedRepositoryValue,
                  options: input.repositoryOptions,
                  selectedValue: selectedRepositoryValue,
                },
              })}
          status={{
            kind: input.status,
            label:
              input.status === "connected"
                ? "Connected"
                : input.status === "error"
                  ? "Error"
                  : "Not connected",
          }}
          terminalControl={{
            ariaLabel: "Open terminal",
            className: "bg-transparent text-foreground shadow-none hover:bg-stone-100",
            disabled: false,
            onClick: () => {
              return;
            },
            pressed: false,
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

export const Default: Story = {
  args: {
    cliControl: {
      ariaLabel: "CLI",
      className: "",
      disabled: false,
      onClick: () => {
        return;
      },
      pressed: false,
      title: "Open Codex CLI",
    },
    diffControl: {
      ariaLabel: "Open changes",
      className: "",
      disabled: false,
      onClick: () => {
        return;
      },
      pressed: false,
      title: "Open changes",
    },
    status: {
      kind: "not_connected",
      label: "Not connected",
    },
    terminalControl: {
      ariaLabel: "Open terminal",
      className: "",
      disabled: false,
      onClick: () => {
        return;
      },
      pressed: false,
      title: "Open terminal",
    },
  },
  render: () => <StoryHeaderActions status="not_connected" />,
};

export const WithPrimaryRepositorySelector: Story = {
  args: {
    ...Default.args,
  },
  render: () => (
    <StoryHeaderActions
      repositoryOptions={StoryRepositoryOptions}
      repositorySelectedValue="/root/mistle"
      status="connected"
    />
  ),
};

export const WithNoRepositorySelected: Story = {
  args: {
    ...Default.args,
  },
  render: () => (
    <StoryHeaderActions
      repositoryOptions={StoryRepositoryOptions}
      repositorySelectedValue="__none__"
      status="connected"
    />
  ),
};

export const WithRepositorySelectorDisabled: Story = {
  args: {
    ...Default.args,
  },
  render: () => (
    <StoryHeaderActions
      repositoryDisabled={true}
      repositoryOptions={StoryRepositoryOptions}
      repositorySelectedValue="/root/mistle"
      status="connected"
    />
  ),
};

export const ErrorStatusWithRepositorySelector: Story = {
  args: {
    ...Default.args,
  },
  render: () => (
    <StoryHeaderActions
      repositoryOptions={StoryRepositoryOptions}
      repositorySelectedValue="/root/platform"
      status="error"
    />
  ),
};
