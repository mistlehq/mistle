import type { Meta, StoryObj } from "@storybook/react-vite";

import type { SessionWorkbenchHeaderRepositoryOption } from "./session-workbench-header-actions.js";
import { SessionWorkbenchHeaderActions } from "./session-workbench-header-actions.js";
import {
  SessionWorkbenchHeaderActionsStoryHarness,
  type SessionWorkbenchHeaderActionsStoryHarnessProps,
} from "./session-workbench-header-actions.story-harness.js";

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

const StorybookArgs = {
  cliControl: {
    ariaLabel: "TUI",
    className: "bg-transparent text-foreground shadow-none hover:bg-stone-100",
    disabled: false,
    onClick: () => {
      return;
    },
    pressed: false,
    title: "Open Codex TUI",
  },
  diffControl: {
    ariaLabel: "Open changes",
    className: "bg-transparent text-foreground shadow-none hover:bg-stone-100",
    disabled: false,
    onClick: () => {
      return;
    },
    pressed: false,
    title: "Open changes",
  },
  status: {
    kind: "not_connected" as const,
    label: "Not connected",
  },
  terminalControl: {
    ariaLabel: "Open terminal",
    className: "bg-transparent text-foreground shadow-none hover:bg-stone-100",
    disabled: false,
    onClick: () => {
      return;
    },
    pressed: false,
    title: "Open terminal",
  },
} satisfies NonNullable<Story["args"]>;

function createStory(input: SessionWorkbenchHeaderActionsStoryHarnessProps): Story {
  return {
    args: StorybookArgs,
    render: () => <SessionWorkbenchHeaderActionsStoryHarness {...input} />,
  };
}

export const Default = createStory({
  repositoryOptions: StoryRepositoryOptions,
  repositorySelectedValue: "/root/mistle",
  status: "connected",
});

export const WithRepositorySelectorRefreshingOpen = createStory({
  repositoryIsRefreshing: true,
  repositoryStartsOpen: true,
  repositoryOptions: [
    ...StoryRepositoryOptions,
    { value: "/root/mistle-temp-docs", label: "mistle-temp-docs" },
  ],
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
