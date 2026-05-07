import { SandboxPtyStates } from "@mistle/sandbox-session-client";
import type { ProcessEntry } from "@mistle/sandbox-session-protocol";
import { useState } from "react";

import type {
  ChatComposerStatusMessage,
  ChatComposerViewModel,
} from "../chat/components/chat-composer.js";
import { noopRespondToServerRequest } from "../chat/components/chat-story-support.js";
import {
  SessionComposerFixtureProps,
  CodexFixtureSessionEntriesWithExploringGroup,
  CodexFixtureSessionServerRequests,
} from "../session-agents/codex/fixtures/session-fixtures.js";
import type { UseSandboxPtyStateResult } from "../sessions/use-sandbox-pty-state.js";
import { ConversationWorkspaceFrame } from "../shared/conversation-workspace-frame.js";
import type { SandboxStatusBadgeUi } from "./sandbox-status-presentation.js";
import {
  SessionConversationBottomPanel,
  SessionConversationMainContent,
} from "./session-conversation-pane.js";
import { SessionPortAccessPopover } from "./session-port-access-popover.js";
import { SessionTerminalSurface } from "./session-terminal-surface.js";
import {
  SessionWorkbenchHeaderActions,
  type SessionWorkbenchHeaderRepositoryOption,
} from "./session-workbench-header-actions.js";
import {
  SessionWorkbenchPageView,
  type SessionWorkbenchAlert,
} from "./session-workbench-page-view.js";
import type { SessionPortAccessState } from "./use-session-port-access.js";

export const StorySandboxInstanceId = "sbi_storybook";
const textEncoder = new TextEncoder();
const StoryRepositoryOptions = [
  { value: "__none__", label: "None" },
  { value: "/root/mistle", label: "mistle" },
  { value: "/root/mistle-docs", label: "mistle-docs" },
] satisfies ReadonlyArray<SessionWorkbenchHeaderRepositoryOption>;
const StorySelectedRepositoryValue = "/root/mistle";
const StoryHeaderButtonClassName = "bg-transparent text-foreground shadow-none hover:bg-stone-100";
const StoryHeaderButtonPressedClassName =
  "bg-stone-200 text-stone-950 shadow-none hover:bg-stone-300";
const StoryPortAccessProcesses = [
  {
    pid: 4321,
    command: "vite dev --host 127.0.0.1 --port 5173",
    listeners: [
      {
        bindAddress: "127.0.0.1",
        port: 5173,
      },
    ],
  },
] satisfies ProcessEntry[];

export type SessionConversationStoryArgs = {
  activeTurnId: React.ComponentProps<typeof SessionConversationMainContent>["activeTurnId"];
  autoScrollToBottomOnInitialLoad: boolean;
  initialBottomScrollResetKey: string | null;
  isTurnInProgress: React.ComponentProps<typeof SessionConversationMainContent>["isTurnInProgress"];
  pendingTurnId: React.ComponentProps<typeof SessionConversationMainContent>["pendingTurnId"];
  chatEntries: React.ComponentProps<typeof SessionConversationMainContent>["chatEntries"];
  composerViewModel: ChatComposerViewModel;
  showWorkingIndicator: boolean;
  statusMessage: ChatComposerStatusMessage | null;
  isRespondingToServerRequest: boolean;
  onRespondToServerRequest: React.ComponentProps<
    typeof SessionConversationMainContent
  >["onRespondToServerRequest"];
  serverRequestPanelEntries: React.ComponentProps<
    typeof SessionConversationMainContent
  >["serverRequestPanelEntries"];
};

export const StorySessionConversationPaneArgs = {
  activeTurnId: null,
  autoScrollToBottomOnInitialLoad: false,
  initialBottomScrollResetKey: "storybook-thread",
  isTurnInProgress: false,
  pendingTurnId: null,
  chatEntries: CodexFixtureSessionEntriesWithExploringGroup,
  composerViewModel: SessionComposerFixtureProps,
  showWorkingIndicator: false,
  statusMessage: null,
  isRespondingToServerRequest: false,
  onRespondToServerRequest: noopRespondToServerRequest,
  serverRequestPanelEntries: CodexFixtureSessionServerRequests,
} satisfies SessionConversationStoryArgs;

export function createStoryPtyChunks(text: string): readonly Uint8Array[] {
  if (text.length === 0) {
    return [];
  }

  return text.split(/(?<=\n)/).map((chunk) => textEncoder.encode(chunk));
}

export function StoryTerminalSurfaceBody(input: {
  initialOutput: string;
  isVisible: boolean;
}): React.JSX.Element {
  const [outputText, setOutputText] = useState(input.initialOutput);

  return (
    <SessionTerminalSurface
      isVisible={input.isVisible}
      lifecycleState={SandboxPtyStates.OPEN}
      onResize={async () => {
        return;
      }}
      onWriteInput={async (nextInput) => {
        setOutputText((currentOutput) => `${currentOutput}${nextInput}`);
      }}
      outputChunks={createStoryPtyChunks(outputText)}
    />
  );
}

export function createStoryLongCliOutput(prefix: string): string {
  return Array.from({ length: 120 }, (_, index) => {
    const lineNumber = String(index + 1).padStart(3, "0");
    return `${prefix} ${lineNumber}: streamed CLI output remains inside the PTY viewport`;
  }).join("\n");
}

export function createStoryWorkbenchCliPtyState(output: string): UseSandboxPtyStateResult {
  return {
    lifecycle: {
      connectedSandboxInstanceId: StorySandboxInstanceId,
      errorMessage: null,
      exitInfo: null,
      resetInfo: null,
      state: SandboxPtyStates.OPEN,
    },
    output: {
      chunks: createStoryPtyChunks(output),
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

type SessionWorkbenchStoryHeaderActionsProps = {
  headerStatusUi?: SandboxStatusBadgeUi;
  isCliVisible?: boolean;
  isDiffVisible?: boolean;
  isTerminalVisible?: boolean;
  onCliToggle?: () => void;
  onDiffToggle?: () => void;
  onTerminalToggle?: () => void;
};

function createStoryHeaderStatus(
  headerStatusUi: SandboxStatusBadgeUi,
): React.ComponentProps<typeof SessionWorkbenchHeaderActions>["status"] {
  if (headerStatusUi.variant === "destructive") {
    return {
      kind: "error",
      label: headerStatusUi.label,
    };
  }

  return {
    kind: headerStatusUi.variant === "secondary" ? "connected" : "not_connected",
    label: headerStatusUi.label,
  };
}

function getStoryHeaderButtonClassName(isPressed: boolean): string {
  return isPressed ? StoryHeaderButtonPressedClassName : StoryHeaderButtonClassName;
}

export function SessionWorkbenchStoryHeaderActions(
  input: SessionWorkbenchStoryHeaderActionsProps,
): React.JSX.Element {
  const [selectedRepositoryValue, setSelectedRepositoryValue] = useState<string | null>(
    StorySelectedRepositoryValue,
  );
  const [isPortAccessPanelOpen, setPortAccessPanelOpen] = useState(false);
  const headerStatusUi = input.headerStatusUi ?? {
    label: "Connected",
    variant: "secondary",
  };
  const isCliVisible = input.isCliVisible ?? false;
  const isDiffVisible = input.isDiffVisible ?? false;
  const isTerminalVisible = input.isTerminalVisible ?? false;
  const handleCliToggle =
    input.onCliToggle ??
    (() => {
      return;
    });
  const handleDiffToggle =
    input.onDiffToggle ??
    (() => {
      return;
    });
  const handleTerminalToggle =
    input.onTerminalToggle ??
    (() => {
      return;
    });
  const portAccessState = {
    buttonDisabledReason: null,
    errorMessage: null,
    isLoadingProcesses: false,
    isOpeningProcessKey: null,
    isPanelOpen: isPortAccessPanelOpen,
    observedAt: null,
    openProcess: async () => {
      return;
    },
    processes: StoryPortAccessProcesses,
    setPanelOpen: setPortAccessPanelOpen,
  } satisfies SessionPortAccessState;

  return (
    <SessionWorkbenchHeaderActions
      cliControl={{
        ariaLabel: "TUI",
        className: getStoryHeaderButtonClassName(isCliVisible),
        disabled: false,
        onClick: handleCliToggle,
        pressed: isCliVisible,
        title: isCliVisible ? "Return to chat" : "Open Codex TUI",
      }}
      diffControl={{
        ariaLabel: isDiffVisible ? "Changes" : "Open changes",
        className: getStoryHeaderButtonClassName(isDiffVisible),
        disabled: false,
        onClick: handleDiffToggle,
        pressed: isDiffVisible,
        title: isDiffVisible ? "Changes" : "Open changes",
      }}
      portAccessControl={<SessionPortAccessPopover state={portAccessState} />}
      repositoryControl={{
        ariaLabel: "Primary repository",
        onValueChange: setSelectedRepositoryValue,
        options: StoryRepositoryOptions,
        selectedValue: selectedRepositoryValue,
        title: "Primary repository",
      }}
      status={createStoryHeaderStatus(headerStatusUi)}
      terminalControl={{
        ariaLabel: isTerminalVisible ? "Terminal" : "Open terminal",
        className: getStoryHeaderButtonClassName(isTerminalVisible),
        disabled: false,
        onClick: handleTerminalToggle,
        pressed: isTerminalVisible,
        title: isTerminalVisible ? "Terminal" : "Open terminal",
      }}
    />
  );
}

export function createStorySessionMainContent(
  overrides?: Partial<SessionConversationStoryArgs>,
): React.JSX.Element {
  const { composerViewModel: _composerViewModel, ...mainContentProps } = {
    ...StorySessionConversationPaneArgs,
    ...overrides,
  };

  return <SessionConversationMainContent {...mainContentProps} />;
}

export function createStorySessionBottomPanel(
  overrides?: Partial<SessionConversationStoryArgs>,
): React.JSX.Element {
  return <SessionConversationBottomPanel {...StorySessionConversationPaneArgs} {...overrides} />;
}

export function renderSessionWorkbenchStory(input: {
  alert?: SessionWorkbenchAlert | null;
  bottomPanel?: React.ReactNode;
  isSecondaryPanelVisible?: boolean;
  isBottomPanelVisible?: boolean;
  mainContentLayout?: React.ComponentProps<typeof SessionWorkbenchPageView>["mainContentLayout"];
  mainContentScrollContainerRef?: React.Ref<HTMLDivElement>;
  mainContent: React.ReactNode;
  primaryBottomPanel: React.ReactNode;
  secondaryPanel?: React.ReactNode;
  sandboxInstanceId?: string | null;
}): React.JSX.Element {
  const mainContentLayoutProps =
    input.mainContentLayout === undefined ? {} : { mainContentLayout: input.mainContentLayout };
  const mainContentScrollContainerRefProps =
    input.mainContentScrollContainerRef === undefined
      ? {}
      : { mainContentScrollContainerRef: input.mainContentScrollContainerRef };

  return (
    <SessionWorkbenchPageView
      alert={input.alert ?? null}
      bottomPanel={input.bottomPanel ?? <></>}
      isBottomPanelVisible={input.isBottomPanelVisible ?? false}
      isSecondaryPanelVisible={input.isSecondaryPanelVisible ?? false}
      mainContent={input.mainContent}
      {...mainContentScrollContainerRefProps}
      primaryBottomPanel={input.primaryBottomPanel}
      secondaryPanel={input.secondaryPanel ?? <></>}
      sandboxInstanceId={input.sandboxInstanceId ?? StorySandboxInstanceId}
      {...mainContentLayoutProps}
    />
  );
}

export function renderSessionWorkbenchStoryWithChrome(input: {
  children: React.ReactNode;
  headerActions?: React.ReactNode;
  headerStatusUi?: SandboxStatusBadgeUi;
  title?: React.ReactNode;
}): React.JSX.Element {
  const headerStatusUi = input.headerStatusUi ?? {
    label: "Connected",
    variant: "secondary",
    className: "bg-emerald-600 text-white hover:bg-emerald-600/90",
  };

  return (
    <div className="from-background to-muted/20 h-screen min-h-0 overflow-hidden bg-linear-to-b">
      <ConversationWorkspaceFrame
        title={
          input.title ?? (
            <span className="block truncate text-sm font-medium text-foreground">
              Storybook session
            </span>
          )
        }
        actions={
          input.headerActions ?? (
            <SessionWorkbenchStoryHeaderActions headerStatusUi={headerStatusUi} />
          )
        }
      >
        {input.children}
      </ConversationWorkspaceFrame>
    </div>
  );
}

export function SessionWorkbenchStoryChrome(input: {
  children: React.ReactNode;
  headerActions?: React.ReactNode;
  headerStatusUi?: SandboxStatusBadgeUi;
  title?: React.ReactNode;
}): React.JSX.Element {
  return renderSessionWorkbenchStoryWithChrome(input);
}

export function renderSessionWorkbenchContentStory(input: {
  alert?: SessionWorkbenchAlert | null;
  bottomPanel?: React.ReactNode;
  headerStatusUi?: SandboxStatusBadgeUi;
  isBottomPanelVisible?: boolean;
  isSecondaryPanelVisible?: boolean;
  mainContent: React.ReactNode;
  mainContentLayout?: React.ComponentProps<typeof SessionWorkbenchPageView>["mainContentLayout"];
  mainContentScrollContainerRef?: React.Ref<HTMLDivElement>;
  primaryBottomPanel: React.ReactNode;
  secondaryPanel?: React.ReactNode;
  sandboxInstanceId?: string | null;
}): React.JSX.Element {
  return renderSessionWorkbenchStoryWithChrome({
    ...(input.headerStatusUi === undefined ? {} : { headerStatusUi: input.headerStatusUi }),
    children: renderSessionWorkbenchStory(input),
  });
}
