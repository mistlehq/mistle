import {
  Button,
  Notice,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@mistle/ui";
import { HouseIcon, LightningIcon, PackageIcon, PuzzlePieceIcon } from "@phosphor-icons/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { MemoryRouter, NavLink } from "react-router";

import { ErrorNotice } from "../auth/error-notice.js";
import { noop } from "../chat/components/chat-story-support.js";
import { SessionsNavToggleItem } from "../navigation/sessions-nav-toggle-item.js";
import {
  SessionComposerFixtureProps,
  SessionComposerFixturePropsForLoadingModel,
  SessionComposerFixturePropsForNonImageCapableModel,
  SessionComposerFixturePropsForUnavailableModel,
  SessionComposerFixtureStatusMessageForLoadingModel,
  SessionComposerFixtureStatusMessageForNonImageCapableModel,
  SessionComposerFixtureStatusMessageForUnavailableModel,
} from "../session-agents/codex/fixtures/session-fixtures.js";
import type { RuntimeConversationNavigatorRow } from "../session-agents/runtime-conversations/runtime-conversation-navigator-model.js";
import {
  RuntimeConversationNavigatorPlanImplementationStoryRows,
  RuntimeConversationNavigatorWorkbenchStoryRows,
} from "../session-agents/runtime-conversations/runtime-conversation-navigator-story-support.js";
import { RuntimeConversationNavigatorPanel } from "../session-agents/runtime-conversations/runtime-conversation-navigator.js";
import { ActionTile } from "../shared/action-tile.js";
import { ConversationWorkspaceFrame } from "../shared/conversation-workspace-frame.js";
import { AppShellView } from "../shell/app-shell-view.js";
import { AppSidebarHeader } from "../shell/app-sidebar-header.js";
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
  headerTitle?: React.ReactNode;
  headerStatusUi: SandboxStatusBadgeUi;
};

function buildPageViewTerminalOutput(cwd: string): string {
  return ["root@sandbox:~# pwd", cwd, "root@sandbox:~# ls", "apps  packages  README.md", ""].join(
    "\n",
  );
}

const FailedSandboxSetupMessage =
  "Failed to initialize sandbox runtime. Cause: failed to submit sandbox init request: control socket returned an error: failed to initialize sandboxd state: failed to apply startup input: runtime plan artifacts[0] lifecycle.install[0] failed (artifactKey=codex-cli op=github_release_install): github release lookup failed for openai/codex release tag match=exact tag=rust-v0.135.0: http 403";

function RuntimeConversationNavigationHeaderTitle(): React.JSX.Element {
  return <span className="block min-w-0 truncate text-sm font-medium">Storybook session</span>;
}

function RuntimeConversationNavigationPanel(input?: {
  rows?: readonly RuntimeConversationNavigatorRow[] | undefined;
}): React.JSX.Element {
  return (
    <RuntimeConversationNavigatorPanel
      isConversationListLimited={false}
      isStartingConversation={false}
      onRefreshConversations={noop}
      onSelectConversation={noop}
      onStartConversation={noop}
      rows={input?.rows ?? RuntimeConversationNavigatorWorkbenchStoryRows}
    />
  );
}

function RuntimeConversationNavigationWorkbenchStory(input?: {
  defaultConversationNavigatorOpen?: boolean;
  navigatorRows?: readonly RuntimeConversationNavigatorRow[];
  primaryBottomPanel?: React.ReactNode;
}): React.JSX.Element {
  const [isConversationNavigatorOpen, setConversationNavigatorOpen] = useState(
    input?.defaultConversationNavigatorOpen ?? false,
  );

  return (
    <SessionWorkbenchStoryChrome
      headerActions={
        <SessionWorkbenchStoryHeaderActions
          isConversationNavigatorVisible={isConversationNavigatorOpen}
          onConversationNavigatorToggle={() => {
            setConversationNavigatorOpen((currentValue) => !currentValue);
          }}
          showConversationNavigatorControl
        />
      }
      title={<RuntimeConversationNavigationHeaderTitle />}
    >
      <SessionWorkbenchPageView
        alert={null}
        bottomPanel={<></>}
        isBottomPanelVisible={false}
        isSecondaryPanelVisible={isConversationNavigatorOpen}
        mainContent={createStorySessionMainContent()}
        primaryBottomPanel={input?.primaryBottomPanel ?? createStorySessionBottomPanel()}
        sandboxInstanceId={StorySandboxInstanceId}
        secondaryPanelDefaultSize="20%"
        secondaryPanelLayoutKey="right-panel"
        secondaryPanelMinSize="16rem"
        secondaryPanel={<RuntimeConversationNavigationPanel rows={input?.navigatorRows} />}
      />
    </SessionWorkbenchStoryChrome>
  );
}

function StoryAppSidebarContent(): React.JSX.Element {
  const [showSessionsSidebar, setShowSessionsSidebar] = useState(true);

  return (
    <SidebarGroup className="pt-0">
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton render={<NavLink to="/" />}>
              <HouseIcon aria-hidden className="size-5 shrink-0 md:size-4" />
              <span>Home</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton render={<NavLink to="/integrations" />}>
              <PuzzlePieceIcon aria-hidden className="size-5 shrink-0 md:size-4" />
              <span>Integrations</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton render={<NavLink to="/sandbox-profiles" />}>
              <PackageIcon aria-hidden className="size-5 shrink-0 md:size-4" />
              <span>Sandbox Profiles</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton render={<NavLink to="/triggers" />}>
              <LightningIcon aria-hidden className="size-5 shrink-0 md:size-4" />
              <span>Triggers</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SessionsNavToggleItem
            checked={showSessionsSidebar}
            onCheckedChange={setShowSessionsSidebar}
          />
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function RuntimeConversationNavigationAppShellStory(input?: {
  defaultConversationNavigatorOpen?: boolean;
  navigatorRows?: readonly RuntimeConversationNavigatorRow[];
  primaryBottomPanel?: React.ReactNode;
}): React.JSX.Element {
  const [isConversationNavigatorOpen, setConversationNavigatorOpen] = useState(
    input?.defaultConversationNavigatorOpen ?? false,
  );

  return (
    <MemoryRouter initialEntries={["/sessions/sbi_storybook"]}>
      <AppShellView
        contentInsetOwner="child"
        mainContent={
          <ConversationWorkspaceFrame
            actions={
              <SessionWorkbenchStoryHeaderActions
                isConversationNavigatorVisible={isConversationNavigatorOpen}
                onConversationNavigatorToggle={() => {
                  setConversationNavigatorOpen((currentValue) => !currentValue);
                }}
                showConversationNavigatorControl
              />
            }
            title={<RuntimeConversationNavigationHeaderTitle />}
          >
            <SessionWorkbenchPageView
              alert={null}
              bottomPanel={<></>}
              isBottomPanelVisible={false}
              isSecondaryPanelVisible={isConversationNavigatorOpen}
              mainContent={createStorySessionMainContent()}
              primaryBottomPanel={input?.primaryBottomPanel ?? createStorySessionBottomPanel()}
              sandboxInstanceId={StorySandboxInstanceId}
              secondaryPanelDefaultSize="20%"
              secondaryPanelLayoutKey="right-panel"
              secondaryPanelMinSize="16rem"
              secondaryPanel={<RuntimeConversationNavigationPanel rows={input?.navigatorRows} />}
            />
          </ConversationWorkspaceFrame>
        }
        renderSidebarTrigger
        sidebarContent={<StoryAppSidebarContent />}
        sidebarDefaultOpen
        sidebarFooterContent={<ErrorNotice message={null} />}
        sidebarHeaderContent={
          <AppSidebarHeader
            activeOrganizationId="org_mistle"
            isSigningOut={false}
            onNavigateToSettings={function onNavigateToSettings() {}}
            onSignOut={function onSignOut() {}}
            onSwitchOrganization={function onSwitchOrganization() {}}
            organizationImageUrl={null}
            organizationName="Mistle Labs"
            organizationSummaryErrorMessage={null}
            organizationSwitcherErrorMessage={null}
            organizations={[{ id: "org_mistle", name: "Mistle Labs" }]}
          />
        }
        topLoadingBar={<div className="h-0" />}
        viewportMode="workspace"
      />
    </MemoryRouter>
  );
}

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
            cwd="/root"
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
    bottomPanel: <div className="h-full w-full border-t bg-card" />,
    isBottomPanelVisible: false,
    isSecondaryPanelVisible: false,
    mainContent: createStorySessionMainContent(),
    primaryBottomPanel: createStorySessionBottomPanel(),
    secondaryPanel: <div className="h-full w-full border-t bg-card" />,
    headerStatusUi: {
      label: "Connected",
      variant: "secondary",
      className: "bg-emerald-600 text-white hover:bg-emerald-600/90",
      indicatorClassName: "border-emerald-700 bg-emerald-600",
    },
  },
  decorators: [
    function StoryDecorator(Story, context): React.JSX.Element {
      if (context.parameters.sessionWorkbenchChrome === false) {
        return <Story />;
      }

      return (
        <SessionWorkbenchStoryChrome
          headerStatusUi={context.args.headerStatusUi}
          title={context.args.headerTitle}
        >
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
      indicatorClassName: "border-muted-foreground/30 bg-muted-foreground/30",
    },
  },
};

export const SessionErrorHeader: Story = {
  args: {
    headerStatusUi: {
      label: "Error",
      variant: "destructive",
      indicatorClassName: "border-destructive bg-destructive",
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
      indicatorClassName: "border-destructive bg-destructive",
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

export const WithRuntimeConversationNavigation: Story = {
  name: "With runtime conversation navigation",
  parameters: {
    sessionWorkbenchChrome: false,
  },
  render: () => <RuntimeConversationNavigationWorkbenchStory />,
};

export const WithRuntimeConversationNavigationAppShell: Story = {
  name: "With runtime conversation navigation in app shell",
  parameters: {
    sessionWorkbenchChrome: false,
  },
  render: () => <RuntimeConversationNavigationAppShellStory />,
};

export const WithRuntimeConversationNavigationAppShellOpen: Story = {
  name: "With runtime conversation navigation panel open",
  parameters: {
    sessionWorkbenchChrome: false,
  },
  render: () => <RuntimeConversationNavigationAppShellStory defaultConversationNavigatorOpen />,
};

export const WithPlanModeComposer: Story = {
  args: {
    primaryBottomPanel: createStorySessionBottomPanel({
      composerViewModel: {
        ...SessionComposerFixtureProps,
        collaborationModeStatus: {
          label: "Plan mode",
          title: "Codex is planning. Submissions stay in Plan mode until implementation starts.",
          onSwitchToDefault: noop,
        },
        composerText: "Trace the current implementation and propose a patch plan.",
        gitBranchLabel: "feature/codex-plan-command",
      },
    }),
  },
};

export const WithPlanImplementationConfirmation: Story = {
  args: {
    primaryBottomPanel: createStorySessionBottomPanel({
      composerViewModel: {
        ...SessionComposerFixtureProps,
        collaborationModeStatus: {
          label: "Plan mode",
          title: "Codex proposed a plan and is waiting for an implementation choice.",
          onSwitchToDefault: noop,
        },
        commandPanel: {
          kind: "choice",
          title: "Implement this plan?",
          choices: [
            {
              label: "Implement",
              onSelect: noop,
              variant: "default",
            },
            {
              label: "More actions",
              onSelect: noop,
              variant: "default",
            },
          ],
        },
        composerText: "",
        gitBranchLabel: "feature/codex-plan-command",
      },
    }),
  },
};

export const WithClearContextPlanImplementation: Story = {
  name: "With clear-context plan implementation",
  parameters: {
    sessionWorkbenchChrome: false,
  },
  render: () => (
    <RuntimeConversationNavigationAppShellStory
      defaultConversationNavigatorOpen
      navigatorRows={RuntimeConversationNavigatorPlanImplementationStoryRows}
      primaryBottomPanel={createStorySessionBottomPanel({
        composerViewModel: {
          ...SessionComposerFixtureProps,
          composerText: "Implement the plan.",
          gitBranchLabel: "feature/codex-plan-command",
          submitDisabled: true,
          submitLabel: "Sending...",
          isSubmitPending: true,
        },
      })}
    />
  ),
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
        cwd="/root"
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
        cwd="/root"
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
      <div className="h-full w-full border-l bg-card p-4">
        <div className="text-sm font-medium text-foreground">Current changes</div>
        <div className="mt-2 text-sm text-muted-foreground">
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
