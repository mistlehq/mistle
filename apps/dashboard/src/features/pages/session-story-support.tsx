import { SandboxPtyStates } from "@mistle/sandbox-session-client";
import { Badge } from "@mistle/ui";

import type {
  ChatComposerStatusMessage,
  ChatComposerViewModel,
} from "../chat/components/chat-composer.js";
import { noop, noopRespondToServerRequest } from "../chat/components/chat-story-support.js";
import {
  SessionComposerFixtureProps,
  CodexFixtureSessionEntriesWithExploringGroup,
  CodexFixtureSessionServerRequests,
} from "../session-agents/codex/fixtures/session-fixtures.js";
import type { UseSandboxPtyStateResult } from "../sessions/use-sandbox-pty-state.js";
import type { SandboxStatusBadgeUi } from "./sandbox-status-presentation.js";
import {
  SessionConversationBottomPanel,
  SessionConversationMainContent,
} from "./session-conversation-pane.js";
import {
  SessionWorkbenchPageView,
  type SessionWorkbenchAlert,
} from "./session-workbench-page-view.js";

export const StorySandboxInstanceId = "sbi_storybook";
const textEncoder = new TextEncoder();

export type SessionConversationStoryArgs = {
  activeTurnId: React.ComponentProps<typeof SessionConversationMainContent>["activeTurnId"];
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
  bottomPanelSize?: number;
  isSecondaryPanelVisible?: boolean;
  isBottomPanelVisible?: boolean;
  mainContentLayout?: React.ComponentProps<typeof SessionWorkbenchPageView>["mainContentLayout"];
  mainContent: React.ReactNode;
  onBottomPanelResize?: (size: number) => void;
  onSecondaryPanelResize?: (size: number) => void;
  primaryBottomPanel: React.ReactNode;
  secondaryPanel?: React.ReactNode;
  secondaryPanelSize?: number;
  sandboxInstanceId?: string | null;
}): React.JSX.Element {
  const mainContentLayoutProps =
    input.mainContentLayout === undefined ? {} : { mainContentLayout: input.mainContentLayout };

  return (
    <SessionWorkbenchPageView
      alert={input.alert ?? null}
      bottomPanel={input.bottomPanel ?? <></>}
      bottomPanelSize={input.bottomPanelSize ?? 32}
      isBottomPanelVisible={input.isBottomPanelVisible ?? false}
      isSecondaryPanelVisible={input.isSecondaryPanelVisible ?? false}
      mainContent={input.mainContent}
      onBottomPanelResize={input.onBottomPanelResize ?? noop}
      onSecondaryPanelResize={input.onSecondaryPanelResize ?? noop}
      primaryBottomPanel={input.primaryBottomPanel}
      secondaryPanel={input.secondaryPanel ?? <></>}
      secondaryPanelSize={input.secondaryPanelSize ?? 38}
      sandboxInstanceId={input.sandboxInstanceId ?? StorySandboxInstanceId}
      {...mainContentLayoutProps}
    />
  );
}

export function renderSessionWorkbenchStoryWithChrome(input: {
  children: React.ReactNode;
  headerActions?: React.ReactNode;
  headerStatusUi?: SandboxStatusBadgeUi;
}): React.JSX.Element {
  const headerStatusUi = input.headerStatusUi ?? {
    label: "Connected",
    variant: "secondary",
    className: "bg-emerald-600 text-white hover:bg-emerald-600/90",
  };

  return (
    <div className="from-background to-muted/20 flex h-screen min-h-0 flex-col overflow-hidden bg-linear-to-b">
      <div className="bg-background/80 flex h-12 flex-none items-center justify-end border-b px-4 backdrop-blur-sm">
        {input.headerActions ??
          (headerStatusUi.variant === "destructive" ? (
            <Badge
              aria-label={headerStatusUi.label}
              className={headerStatusUi.className}
              title={headerStatusUi.label}
              variant={headerStatusUi.variant}
            >
              {headerStatusUi.label}
            </Badge>
          ) : (
            <span
              aria-label={headerStatusUi.label}
              className={[
                "inline-block size-2.5 rounded-full border",
                headerStatusUi.variant === "secondary"
                  ? "border-emerald-700 bg-emerald-600"
                  : "border-stone-300 bg-stone-300",
              ].join(" ")}
              role="status"
              title={headerStatusUi.label}
            />
          ))}
      </div>
      <div className="min-h-0 flex-1">{input.children}</div>
    </div>
  );
}

export function SessionWorkbenchStoryChrome(input: {
  children: React.ReactNode;
  headerActions?: React.ReactNode;
  headerStatusUi?: SandboxStatusBadgeUi;
}): React.JSX.Element {
  return renderSessionWorkbenchStoryWithChrome(input);
}

export function renderSessionWorkbenchContentStory(input: {
  alert?: SessionWorkbenchAlert | null;
  bottomPanel?: React.ReactNode;
  bottomPanelSize?: number;
  headerStatusUi?: SandboxStatusBadgeUi;
  isBottomPanelVisible?: boolean;
  isSecondaryPanelVisible?: boolean;
  mainContent: React.ReactNode;
  mainContentLayout?: React.ComponentProps<typeof SessionWorkbenchPageView>["mainContentLayout"];
  onBottomPanelResize?: (size: number) => void;
  onSecondaryPanelResize?: (size: number) => void;
  primaryBottomPanel: React.ReactNode;
  secondaryPanel?: React.ReactNode;
  secondaryPanelSize?: number;
  sandboxInstanceId?: string | null;
}): React.JSX.Element {
  return renderSessionWorkbenchStoryWithChrome({
    ...(input.headerStatusUi === undefined ? {} : { headerStatusUi: input.headerStatusUi }),
    children: renderSessionWorkbenchStory(input),
  });
}
