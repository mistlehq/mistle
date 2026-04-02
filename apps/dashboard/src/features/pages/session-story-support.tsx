import { SandboxPtyStates } from "@mistle/sandbox-session-client";
import { Badge } from "@mistle/ui";

import type { ChatComposerViewModel } from "../chat/components/chat-composer.js";
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
  chatEntries: React.ComponentProps<typeof SessionConversationMainContent>["chatEntries"];
  composerViewModel: ChatComposerViewModel;
  isRespondingToServerRequest: boolean;
  onRespondToServerRequest: React.ComponentProps<
    typeof SessionConversationMainContent
  >["onRespondToServerRequest"];
  serverRequestPanelEntries: React.ComponentProps<
    typeof SessionConversationMainContent
  >["serverRequestPanelEntries"];
};

export const StorySessionConversationPaneArgs = {
  chatEntries: CodexFixtureSessionEntriesWithExploringGroup,
  composerViewModel: SessionComposerFixtureProps,
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
  alerts?: readonly SessionWorkbenchAlert[];
  isSecondaryPanelVisible?: boolean;
  mainContentLayout?: React.ComponentProps<typeof SessionWorkbenchPageView>["mainContentLayout"];
  mainContent: React.ReactNode;
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
      alerts={input.alerts ?? []}
      isSecondaryPanelVisible={input.isSecondaryPanelVisible ?? false}
      mainContent={input.mainContent}
      onSecondaryPanelResize={input.onSecondaryPanelResize ?? noop}
      primaryBottomPanel={input.primaryBottomPanel}
      secondaryPanel={input.secondaryPanel ?? <></>}
      secondaryPanelSize={input.secondaryPanelSize ?? 38}
      sandboxInstanceId={input.sandboxInstanceId ?? StorySandboxInstanceId}
      {...mainContentLayoutProps}
    />
  );
}

export function SessionWorkbenchStoryChrome(input: {
  children: React.ReactNode;
  headerStatusUi?: SandboxStatusBadgeUi;
}): React.JSX.Element {
  const headerStatusUi = input.headerStatusUi ?? {
    label: "Connected",
    variant: "secondary",
    className: "bg-emerald-600 text-white hover:bg-emerald-600/90",
  };

  return (
    <div className="from-background to-muted/20 min-h-screen bg-linear-to-b">
      <div className="bg-background/80 flex h-12 items-center justify-end border-b px-4 backdrop-blur-sm">
        <Badge className={headerStatusUi.className} variant={headerStatusUi.variant}>
          {headerStatusUi.label}
        </Badge>
      </div>
      <div className="h-[calc(100vh-3rem)]">{input.children}</div>
    </div>
  );
}
