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
import type { SandboxStatusBadgeUi } from "./sandbox-status-presentation.js";
import { SessionCliPanel } from "./session-cli-panel.js";
import {
  createStoryLongCliOutput,
  createStoryWorkbenchCliPtyState,
  createStorySessionBottomPanel,
  createStorySessionMainContent,
  SessionWorkbenchStoryChrome,
  StoryTerminalSurfaceBody,
  StorySandboxInstanceId,
} from "./session-story-support.js";
import { SessionTerminalWorkspaceView } from "./session-terminal-workspace.js";
import { SessionWorkbenchHeaderActions } from "./session-workbench-header-actions.js";
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

function StoryPageViewHeaderToggleTerminalWorkspace(): React.JSX.Element {
  const [isBottomPanelVisible, setIsBottomPanelVisible] = useState(true);

  return (
    <SessionWorkbenchStoryChrome
      headerActions={
        <SessionWorkbenchHeaderActions
          cliControl={{
            ariaLabel: "TUI",
            className: "bg-transparent text-foreground shadow-none hover:bg-stone-100",
            disabled: false,
            onClick: () => {
              return;
            },
            pressed: false,
            title: "Open Codex TUI",
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
          status={{
            kind: "connected",
            label: "Connected",
          }}
          terminalControl={{
            ariaLabel: isBottomPanelVisible ? "Terminal" : "Open terminal",
            className: isBottomPanelVisible
              ? "bg-stone-200 text-stone-950 shadow-none hover:bg-stone-300"
              : "bg-transparent text-foreground shadow-none hover:bg-stone-100",
            disabled: false,
            onClick: () => {
              setIsBottomPanelVisible((currentValue) => !currentValue);
            },
            pressed: isBottomPanelVisible,
            title: isBottomPanelVisible ? "Terminal" : "Open terminal",
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

export const WithErrorNoticees: Story = {
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
