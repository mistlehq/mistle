import { Badge } from "@mistle/ui";

import { noop, noopRespondToServerRequest } from "../chat/components/chat-story-support.js";
import {
  SessionComposerFixtureProps,
  CodexFixtureSessionEntriesWithExploringGroup,
  CodexFixtureSessionServerRequests,
} from "../session-agents/codex/fixtures/session-fixtures.js";
import {
  SessionConversationBottomPanel,
  SessionConversationMainContent,
  type SessionConversationComposerProps,
} from "./session-conversation-pane.js";
import {
  SessionWorkbenchPageView,
  type SessionWorkbenchAlert,
} from "./session-workbench-page-view.js";

export const StorySandboxInstanceId = "sbi_storybook";

export type SessionConversationStoryArgs = {
  chatEntries: React.ComponentProps<typeof SessionConversationMainContent>["chatEntries"];
  composerProps: SessionConversationComposerProps;
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
  composerProps: SessionComposerFixtureProps,
  isRespondingToServerRequest: false,
  onRespondToServerRequest: noopRespondToServerRequest,
  serverRequestPanelEntries: CodexFixtureSessionServerRequests,
} satisfies SessionConversationStoryArgs;

export function createStorySessionMainContent(
  overrides?: Partial<SessionConversationStoryArgs>,
): React.JSX.Element {
  return <SessionConversationMainContent {...StorySessionConversationPaneArgs} {...overrides} />;
}

export function createStorySessionBottomPanel(
  overrides?: Partial<SessionConversationStoryArgs>,
): React.JSX.Element {
  return <SessionConversationBottomPanel {...StorySessionConversationPaneArgs} {...overrides} />;
}

export function renderSessionWorkbenchStory(input: {
  alerts?: readonly SessionWorkbenchAlert[];
  isSecondaryPanelVisible?: boolean;
  mainContent: React.ReactNode;
  onSecondaryPanelResize?: (size: number) => void;
  primaryBottomPanel: React.ReactNode;
  secondaryPanel?: React.ReactNode;
  secondaryPanelSize?: number;
  sandboxInstanceId?: string | null;
}): React.JSX.Element {
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
    />
  );
}

export function SessionWorkbenchStoryChrome(input: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="from-background to-muted/20 min-h-screen bg-linear-to-b">
      <div className="bg-background/80 flex h-12 items-center justify-end border-b px-4 backdrop-blur-sm">
        <Badge className="bg-emerald-600 text-white hover:bg-emerald-600/90" variant="secondary">
          Connected
        </Badge>
      </div>
      <div className="h-[calc(100vh-3rem)]">{input.children}</div>
    </div>
  );
}
