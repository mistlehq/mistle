import { Button, Notice } from "@mistle/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { noop } from "../chat/components/chat-story-support.js";
import {
  SessionComposerFixturePropsForLoadingModel,
  SessionComposerFixturePropsForNonImageCapableModel,
  SessionComposerFixturePropsForUnavailableModel,
  SessionComposerFixtureStatusMessageForLoadingModel,
  SessionComposerFixtureStatusMessageForNonImageCapableModel,
  SessionComposerFixtureStatusMessageForUnavailableModel,
} from "../session-agents/codex/fixtures/session-fixtures.js";
import { ActionTile } from "../shared/action-tile.js";
import type { SandboxStatusBadgeUi } from "./sandbox-status-presentation.js";
import { SessionCliPanel } from "./session-cli-panel.js";
import {
  createStoryLongCliOutput,
  createStoryWorkbenchCliPtyState,
  createStorySessionBottomPanel,
  createStorySessionMainContent,
  SessionWorkbenchStoryChrome,
  SessionWorkbenchStoryHeaderActions,
  StoryTerminalSurfaceBody,
  StorySandboxInstanceId,
} from "./session-story-support.js";
import { SessionTerminalWorkspaceView } from "./session-terminal-workspace.js";
import { SessionWorkbenchPageView } from "./session-workbench-page-view.js";

type SessionWorkbenchPageViewStoryArgs = React.ComponentProps<typeof SessionWorkbenchPageView> & {
  headerStatusUi: SandboxStatusBadgeUi;
};

function buildPageViewTerminalOutput(cwd: string | null): string {
  return [
    "root@sandbox:~# pwd",
    cwd ?? "/root",
    "root@sandbox:~# ls",
    "apps  packages  README.md",
    "",
  ].join("\n");
}

const FailedSandboxSetupMessage =
  "Failed to initialize sandbox runtime. Cause: failed to submit sandbox init request: control socket returned an error: failed to initialize sandboxd state: failed to apply startup input: runtime plan artifacts[0] lifecycle.install[0] failed (artifactKey=codex-cli op=github_release_install): github release lookup failed for openai/codex release tag match=exact tag=rust-v0.128.0: http 403";

function FailedSetupWithRestartActionStoryContent(): React.JSX.Element {
  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-4 px-4 py-6">
      <ActionTile
        action={<Button type="button">Start new session</Button>}
        className="border-primary/40 bg-primary/5"
        description="Start a new session to try again"
        title="Session failed to start"
      />
      <Notice title="Sandbox failed" variant="alert">
        {FailedSandboxSetupMessage}
      </Notice>
    </div>
  );
}

function StoryPageViewHeaderToggleTerminalWorkspace(): React.JSX.Element {
  const [isBottomPanelVisible, setIsBottomPanelVisible] = useState(true);

  return (
    <SessionWorkbenchStoryChrome
      headerActions={
        <SessionWorkbenchStoryHeaderActions
          isTerminalVisible={isBottomPanelVisible}
          onTerminalToggle={() => {
            setIsBottomPanelVisible((currentValue) => !currentValue);
          }}
        />
      }
    >
      <SessionWorkbenchPageView
        alert={null}
        bottomPanel={
          <SessionTerminalWorkspaceView
            cwd={null}
            isVisible={isBottomPanelVisible}
            onWorkspaceEmpty={noop}
            renderTerminalPanel={(panelInput) => (
              <StoryTerminalSurfaceBody
                initialOutput={buildPageViewTerminalOutput(panelInput.cwd)}
                isVisible={panelInput.isPanelVisible}
              />
            )}
          />
        }
        isBottomPanelVisible={isBottomPanelVisible}
        isSecondaryPanelVisible={false}
        mainContent={
          <SessionCliPanel
            ptyState={createStoryWorkbenchCliPtyState(createStoryLongCliOutput("task"))}
          />
        }
        mainContentLayout={{ scroll: "contained", width: "full" }}
        primaryBottomPanel={null}
        sandboxInstanceId={StorySandboxInstanceId}
        secondaryPanel={<></>}
      />
    </SessionWorkbenchStoryChrome>
  );
}

const meta = {
  title: "Dashboard/Sessions/SessionWorkbench/PageView",
  component: SessionWorkbenchPageView,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    sandboxInstanceId: StorySandboxInstanceId,
    alert: null,
    bottomPanel: <div className="h-full w-full border-t bg-white" />,
    isBottomPanelVisible: false,
    isSecondaryPanelVisible: false,
    mainContent: createStorySessionMainContent(),
    primaryBottomPanel: createStorySessionBottomPanel(),
    secondaryPanel: <div className="h-full w-full border-t bg-white" />,
    headerStatusUi: {
      label: "Connected",
      variant: "secondary",
      className: "bg-emerald-600 text-white hover:bg-emerald-600/90",
    },
  },
  decorators: [
    function StoryDecorator(Story, context): React.JSX.Element {
      return (
        <SessionWorkbenchStoryChrome headerStatusUi={context.args.headerStatusUi}>
          <Story />
        </SessionWorkbenchStoryChrome>
      );
    },
  ],
} satisfies Meta<SessionWorkbenchPageViewStoryArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NotConnectedHeader: Story = {
  args: {
    headerStatusUi: {
      label: "Not connected",
      variant: "outline",
    },
  },
};

export const SessionErrorHeader: Story = {
  args: {
    headerStatusUi: {
      label: "Error",
      variant: "destructive",
    },
  },
};

export const WithErrorNotices: Story = {
  args: {
    alert: {
      title: "Could not load sandbox status",
      description: "The status endpoint returned a temporary network error.",
    },
  },
};

export const WithCliEntryFailureNotice: Story = {
  args: {
    alert: {
      title: "Could not start Codex TUI",
      description: "codex executable missing from the sandbox image",
    },
  },
};

export const WithChatRestoreFailureNotice: Story = {
  args: {
    alert: {
      title: "Could not restore chat",
      description: "Minting sandbox connection token failed: Could not mint connection token.",
    },
  },
};

export const FailedSetupWithRestartAction: Story = {
  args: {
    headerStatusUi: {
      label: "Error",
      variant: "destructive",
    },
    alert: null,
    mainContent: <FailedSetupWithRestartActionStoryContent />,
    mainContentLayout: { scroll: "contained", width: "full" },
    primaryBottomPanel: null,
    isBottomPanelVisible: false,
    bottomPanel: <></>,
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
      },
      statusMessage: SessionComposerFixtureStatusMessageForNonImageCapableModel,
    }),
  },
};

export const WithUnavailableModelNotice: Story = {
  args: {
    primaryBottomPanel: createStorySessionBottomPanel({
      composerViewModel: {
        ...SessionComposerFixturePropsForUnavailableModel,
      },
      statusMessage: SessionComposerFixtureStatusMessageForUnavailableModel,
    }),
  },
};

export const WithLoadingSelectedModelNotice: Story = {
  args: {
    primaryBottomPanel: createStorySessionBottomPanel({
      composerViewModel: {
        ...SessionComposerFixturePropsForLoadingModel,
      },
      statusMessage: SessionComposerFixtureStatusMessageForLoadingModel,
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
    isBottomPanelVisible: true,
    mainContent: (
      <SessionCliPanel
        ptyState={createStoryWorkbenchCliPtyState(createStoryLongCliOutput("task"))}
      />
    ),
    mainContentLayout: { scroll: "contained", width: "full" },
    primaryBottomPanel: null,
    bottomPanel: (
      <SessionTerminalWorkspaceView
        cwd={null}
        isVisible
        onWorkspaceEmpty={noop}
        renderTerminalPanel={(panelInput) => (
          <StoryTerminalSurfaceBody
            initialOutput={buildPageViewTerminalOutput(panelInput.cwd)}
            isVisible={panelInput.isPanelVisible}
          />
        )}
      />
    ),
  },
};

export const CliSplitWithTerminalAndSecondaryPane: Story = {
  args: {
    isBottomPanelVisible: true,
    isSecondaryPanelVisible: true,
    mainContent: (
      <SessionCliPanel
        ptyState={createStoryWorkbenchCliPtyState(createStoryLongCliOutput("task"))}
      />
    ),
    mainContentLayout: { scroll: "contained", width: "full" },
    primaryBottomPanel: null,
    bottomPanel: (
      <SessionTerminalWorkspaceView
        cwd={null}
        isVisible
        onWorkspaceEmpty={noop}
        renderTerminalPanel={(panelInput) => (
          <StoryTerminalSurfaceBody
            initialOutput={buildPageViewTerminalOutput(panelInput.cwd)}
            isVisible={panelInput.isPanelVisible}
          />
        )}
      />
    ),
    secondaryPanel: (
      <div className="h-full w-full border-l bg-stone-50 p-4">
        <div className="text-sm font-medium text-stone-900">Current changes</div>
        <div className="mt-2 text-sm text-stone-600">
          Secondary diff pane enabled to exercise the nested horizontal and vertical resizable
          layout together.
        </div>
      </div>
    ),
  },
};

export const HeaderToggleTerminalWorkspace: Story = {
  render: () => <StoryPageViewHeaderToggleTerminalWorkspace />,
};
