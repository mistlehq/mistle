import { SandboxPtyStates } from "@mistle/sandbox-session-client";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { noop } from "../chat/components/chat-story-support.js";
import {
  SessionComposerFixturePropsForLoadingModel,
  SessionComposerFixturePropsForNonImageCapableModel,
  SessionComposerFixturePropsForUnavailableModel,
  SessionComposerFixtureStatusMessageForLoadingModel,
  SessionComposerFixtureStatusMessageForNonImageCapableModel,
  SessionComposerFixtureStatusMessageForUnavailableModel,
} from "../session-agents/codex/fixtures/session-fixtures.js";
import type { UseSandboxPtyStateResult } from "../sessions/use-sandbox-pty-state.js";
import { SessionCliPanel } from "./session-cli-panel.js";
import {
  createStorySessionBottomPanel,
  createStorySessionMainContent,
  SessionWorkbenchStoryChrome,
  StorySandboxInstanceId,
} from "./session-story-support.js";
import { SessionWorkbenchPageView } from "./session-workbench-page-view.js";

const textEncoder = new TextEncoder();

function createWorkbenchCliPtyState(output: string): UseSandboxPtyStateResult {
  return {
    lifecycle: {
      connectedSandboxInstanceId: StorySandboxInstanceId,
      errorMessage: null,
      exitInfo: null,
      resetInfo: null,
      state: SandboxPtyStates.OPEN,
    },
    output: {
      chunks: output
        .split(/(?<=\n)/)
        .filter(Boolean)
        .map((chunk) => textEncoder.encode(chunk)),
      clearOutput: () => {
        return;
      },
    },
    actions: {
      closePty: async () => {
        return;
      },
      disconnectPty: async () => {
        return;
      },
      openPty: async () => {
        return;
      },
      resizePty: async () => {
        return;
      },
      writeInput: async () => {
        return;
      },
    },
  };
}

function createLongCliOutput(): string {
  return Array.from({ length: 120 }, (_, index) => {
    const lineNumber = String(index + 1).padStart(3, "0");
    return `task ${lineNumber}: streamed CLI output remains inside the PTY viewport`;
  }).join("\n");
}

const meta = {
  title: "Dashboard/Pages/SessionWorkbenchPageView",
  component: SessionWorkbenchPageView,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    sandboxInstanceId: StorySandboxInstanceId,
    alerts: [],
    isSecondaryPanelVisible: false,
    mainContent: createStorySessionMainContent(),
    primaryBottomPanel: createStorySessionBottomPanel(),
    secondaryPanel: <div className="h-full w-full border-t bg-white" />,
    secondaryPanelSize: 38,
    onSecondaryPanelResize: noop,
  },
  decorators: [
    function StoryDecorator(Story): React.JSX.Element {
      return (
        <SessionWorkbenchStoryChrome>
          <Story />
        </SessionWorkbenchStoryChrome>
      );
    },
  ],
} satisfies Meta<typeof SessionWorkbenchPageView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithAlerts: Story = {
  args: {
    alerts: [
      {
        title: "Could not load sandbox status",
        description: "The status endpoint returned a temporary network error.",
      },
      {
        title: "Sandbox failed",
        description: "The underlying sandbox exited before the session fully connected.",
      },
    ],
  },
};

export const WithSecondaryPane: Story = {
  args: {
    isSecondaryPanelVisible: true,
  },
};

export const WithNonImageCapableModelWarning: Story = {
  args: {
    primaryBottomPanel: createStorySessionBottomPanel({
      composerViewModel: {
        ...SessionComposerFixturePropsForNonImageCapableModel,
        statusMessage: SessionComposerFixtureStatusMessageForNonImageCapableModel,
      },
    }),
  },
};

export const WithUnavailableModelAlert: Story = {
  args: {
    primaryBottomPanel: createStorySessionBottomPanel({
      composerViewModel: {
        ...SessionComposerFixturePropsForUnavailableModel,
        statusMessage: SessionComposerFixtureStatusMessageForUnavailableModel,
      },
    }),
  },
};

export const WithLoadingSelectedModelAlert: Story = {
  args: {
    primaryBottomPanel: createStorySessionBottomPanel({
      composerViewModel: {
        ...SessionComposerFixturePropsForLoadingModel,
        statusMessage: SessionComposerFixtureStatusMessageForLoadingModel,
      },
    }),
  },
};

export const MissingSessionId: Story = {
  args: {
    sandboxInstanceId: null,
  },
};

export const CliFullHeight: Story = {
  args: {
    mainContent: <SessionCliPanel ptyState={createWorkbenchCliPtyState(createLongCliOutput())} />,
    mainContentLayout: { scroll: "contained", width: "full" },
    primaryBottomPanel: null,
  },
};

export const CliSplitWithTerminal: Story = {
  args: {
    isSecondaryPanelVisible: true,
    mainContent: <SessionCliPanel ptyState={createWorkbenchCliPtyState(createLongCliOutput())} />,
    mainContentLayout: { scroll: "contained", width: "full" },
    primaryBottomPanel: null,
  },
};
