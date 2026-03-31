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
import { SessionCliPanel } from "./session-cli-panel.js";
import {
  createStoryLongCliOutput,
  createStoryWorkbenchCliPtyState,
  createStorySessionBottomPanel,
  createStorySessionMainContent,
  SessionWorkbenchStoryChrome,
  StorySandboxInstanceId,
} from "./session-story-support.js";
import { SessionTerminalPanel } from "./session-terminal-panel.js";
import { SessionWorkbenchPageView } from "./session-workbench-page-view.js";

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

export const WithErrorStatusBoxes: Story = {
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

export const WithCliEntryFailureStatusBox: Story = {
  args: {
    alerts: [
      {
        title: "Could not start Codex CLI",
        description: "codex executable missing from the sandbox image",
      },
    ],
  },
};

export const WithChatRestoreFailureStatusBox: Story = {
  args: {
    alerts: [
      {
        title: "Could not restore chat",
        description: "Minting sandbox connection token failed: Could not mint connection token.",
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

export const WithUnavailableModelStatusBox: Story = {
  args: {
    primaryBottomPanel: createStorySessionBottomPanel({
      composerViewModel: {
        ...SessionComposerFixturePropsForUnavailableModel,
        statusMessage: SessionComposerFixtureStatusMessageForUnavailableModel,
      },
    }),
  },
};

export const WithLoadingSelectedModelStatusBox: Story = {
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

export const CliSplitWithTerminal: Story = {
  args: {
    isSecondaryPanelVisible: true,
    mainContent: (
      <SessionCliPanel
        ptyState={createStoryWorkbenchCliPtyState(createStoryLongCliOutput("task"))}
      />
    ),
    mainContentLayout: { scroll: "contained", width: "full" },
    primaryBottomPanel: null,
    secondaryPanel: (
      <SessionTerminalPanel
        isConnectionReady={true}
        isResumingSandbox={false}
        isVisible={true}
        onDisconnectTerminal={noop}
        onHide={noop}
        onRequestSandboxResume={async () => {
          return;
        }}
        ptyState={createStoryWorkbenchCliPtyState(
          [
            "root@sandbox:~# pwd",
            "/root",
            "root@sandbox:~# ls",
            "apps  packages  README.md",
            "",
          ].join("\n"),
        )}
        sandboxInstanceId={StorySandboxInstanceId}
        sandboxStatus="running"
      />
    ),
  },
};
