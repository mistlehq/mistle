import type { AnyIntegrationDefinition } from "@mistle/integrations-core";
import { createBrowserIntegrationRegistry } from "@mistle/integrations-definitions/browser";
import { Button } from "@mistle/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { MemoryRouter } from "react-router";

import { withDashboardPageStory, withDashboardWorkspaceStory } from "../../storybook/decorators.js";
import type { ChatEntry } from "../chat/chat-types.js";
import { noopRespondToServerRequest } from "../chat/components/chat-story-support.js";
import {
  DesignerBlueprintCurrentTabHref,
  DesignerBlueprintCurrentTabId,
  type DesignerBlueprintDocument,
} from "../designer/designer-blueprint-schema.js";
import type { DesignerSession, DesignerSessionListItem } from "../designer/designer-service.js";
import type {
  IntegrationConnection,
  IntegrationTarget,
} from "../integrations/integrations-service.js";
import { createReadySessionComposerStateInput } from "../session-agents/codex/fixtures/session-fixtures.js";
import { organizationSummaryQueryKey } from "../shell/organization-summary.js";
import { SESSION_QUERY_KEY } from "../shell/session-query.js";
import { DesignerPageView } from "./designer-page-view.js";
import {
  DesignerBlueprintCanvasPanel,
  DesignerBlueprintCollapsedCommentButton,
  DesignerBlueprintDraftCommentEditor,
  DesignerBlueprintFloatingComment,
  DesignerBlueprintPendingCommentEditor,
  DesignerCanvasWorkspace,
} from "./designer-session-page-view.js";
import { createStoryConnectionMethods } from "./organization-integrations-settings-page-story-support.js";
import {
  type PendingSessionBlueprintComment,
  type PendingSessionBlueprintCommentInput,
} from "./session-blueprint-comment.js";
import {
  SessionConversationBottomPanelDraftController,
  SessionConversationMainContent,
} from "./session-conversation-pane.js";
import { renderSessionWorkbenchContentStory } from "./session-story-support.js";
import { SessionWorkbenchPageView } from "./session-workbench-page-view.js";
import { SETTINGS_INTEGRATIONS_QUERY_KEY } from "./use-integrations-directory-state.js";

const IntegrationRegistry = createBrowserIntegrationRegistry();

type StoryDesignerBlueprintCanvasTab = Extract<
  DesignerSession["canvasTabs"][number],
  { kind: "blueprint" }
>;

const StoryDesignerRuntimeFields: Pick<
  DesignerSession,
  "runtimeContext" | "sandboxProfileId" | "sandboxProfileVersion"
> = {
  sandboxProfileId: "designer",
  sandboxProfileVersion: 1,
  runtimeContext: {
    agentRuntimeId: "codex",
    launchCwd: "/workspace",
    primaryRepositoryRoot: null,
  },
};

const StoryDesignerSessions: readonly DesignerSession[] = [
  {
    id: "dsn_triage",
    organizationId: "org_story",
    sandboxInstanceId: "sbi_designer_triage",
    ...StoryDesignerRuntimeFields,
    title: "Design triage agent",
    status: "running",
    connectable: true,
    failureCode: null,
    failureMessage: null,
    startupOperation: null,
    initialPrompt: "Build a triage agent for incoming GitHub issues and Linear bugs.",
    canvasTabs: [
      {
        kind: "blueprint",
        id: DesignerBlueprintCurrentTabId,
        title: "Blueprint",
        href: DesignerBlueprintCurrentTabHref,
        blueprint: {
          version: 1,
          title: "Triage agent blueprint",
          outcome: {
            label: "Classify Linear and GitHub work and route the next action",
            description: "Shows the workflow from inbound work to triage outcomes.",
          },
          items: [
            {
              id: "linear-trigger",
              kind: "trigger",
              integrationTargetKey: "linear-default",
              state: "proposed",
              when: [
                {
                  label: "Linear issue label or state changed",
                },
              ],
            },
            {
              id: "github-trigger",
              kind: "trigger",
              integrationTargetKey: "github-cloud",
              state: "proposed",
              when: [
                {
                  label: "GitHub pull request or issue activity",
                },
              ],
            },
            {
              id: "normalize-context",
              kind: "agent_step",
              label: "Normalize context",
              description: "Collect item text, metadata, requester, linked resources, and history.",
              state: "proposed",
            },
            {
              id: "routing",
              kind: "routing_policy",
              state: "proposed",
              rules: [
                {
                  conditionLabel: "Escalations",
                  when: [
                    {
                      field: "severity",
                      operator: "includes",
                      value: "urgent",
                    },
                  ],
                  routeTo: "escalate",
                },
                {
                  conditionLabel: "Normal triage",
                  when: [
                    {
                      field: "severity",
                      operator: "excludes",
                      value: "urgent",
                    },
                  ],
                  routeTo: "triage-update",
                },
              ],
            },
            {
              id: "triage-update",
              kind: "workflow_output",
              label: "Write triage update",
              state: "proposed",
            },
            {
              id: "escalate",
              kind: "workflow_output",
              label: "Escalate urgent item",
              state: "proposed",
            },
          ],
          links: [
            {
              from: "linear-trigger",
              to: "normalize-context",
              kind: "triggers",
            },
            {
              from: "github-trigger",
              to: "normalize-context",
              kind: "triggers",
            },
            {
              from: "normalize-context",
              to: "routing",
              kind: "routes_to",
            },
            {
              from: "routing",
              to: "triage-update",
              kind: "routes_to",
            },
            {
              from: "routing",
              to: "escalate",
              kind: "routes_to",
            },
          ],
          actions: [],
        },
      },
      {
        kind: "route",
        id: "integrations",
        title: "Integrations",
        href: "/integrations",
      },
      {
        kind: "route",
        id: "sandbox-profile",
        title: "Sandbox Profile",
        href: "/sandbox-profiles/sbp_story/draft",
      },
    ],
    createdAt: "2026-04-01T09:00:00.000Z",
    updatedAt: "2026-04-01T09:00:00.000Z",
  },
  {
    id: "dsn_billing_reconciliation",
    organizationId: "org_story",
    sandboxInstanceId: "sbi_designer_billing_reconciliation",
    ...StoryDesignerRuntimeFields,
    title:
      "Design a billing reconciliation agent for Linear escalations and GitHub incident follow-up",
    status: "starting",
    connectable: true,
    failureCode: null,
    failureMessage: null,
    startupOperation: {
      operationId: "owfr_story_designer_billing_startup",
      operationKind: "start",
    },
    initialPrompt: "Design a billing reconciliation agent for escalations.",
    canvasTabs: [],
    createdAt: "2026-04-01T08:55:00.000Z",
    updatedAt: "2026-04-01T08:55:00.000Z",
  },
  {
    id: "dsn_docs_sidebar",
    organizationId: "org_story",
    sandboxInstanceId: "sbi_designer_docs_sidebar",
    ...StoryDesignerRuntimeFields,
    title:
      "Compare the current sidebar truncation behavior with the sessions table so designer conversations stay compact",
    status: "stopped",
    connectable: false,
    failureCode: null,
    failureMessage: null,
    startupOperation: null,
    initialPrompt: "Compare sidebar truncation behavior.",
    canvasTabs: [],
    createdAt: "2026-03-31T15:30:00.000Z",
    updatedAt: "2026-03-31T15:30:00.000Z",
  },
  {
    id: "dsn_failed_webhook",
    organizationId: "org_story",
    sandboxInstanceId: "sbi_designer_failed_webhook",
    ...StoryDesignerRuntimeFields,
    title: null,
    status: "failed",
    connectable: false,
    failureCode: "sandbox_bootstrap_failed",
    failureMessage: "Could not start the Designer sandbox runtime because image pull failed.",
    startupOperation: null,
    initialPrompt: "Build a webhook failure triage agent.",
    canvasTabs: [],
    createdAt: "2026-03-31T12:00:00.000Z",
    updatedAt: "2026-03-31T12:00:00.000Z",
  },
];

const AiSoftwareFactoryBlueprint = {
  version: 1,
  title: "AI Software Factory Draft",
  outcome: {
    label: "Issue-to-PR software factory",
    description:
      "Move well-defined software work from an issue system into implementation, pull request review, rework, and process improvement with agent assistance.",
  },
  items: [
    {
      id: "issue-ready",
      kind: "trigger",
      state: "proposed",
      when: [
        {
          label: "Readiness signal received",
        },
        {
          label: "Acceptance criteria are present",
        },
      ],
    },
    {
      id: "readiness-check",
      kind: "agent_step",
      label: "Check readiness and scope",
      description:
        "Verify acceptance criteria, affected area, blockers, and repository target before implementation starts.",
      state: "proposed",
    },
    {
      id: "implement-change",
      kind: "agent_step",
      label: "Plan, edit, and test",
      description:
        "Create an implementation plan, change the code, and run the relevant checks before producing reviewable work.",
      state: "proposed",
    },
    {
      id: "pr-output",
      kind: "workflow_output",
      label: "Pull request opened or updated",
      description:
        "Produce a pull request with implementation notes, test evidence, and issue linkage.",
      state: "proposed",
    },
    {
      id: "review-step",
      kind: "agent_step",
      label: "Review change quality",
      description:
        "A separate review agent or human reviewer checks acceptance criteria, regressions, tests, and maintainability.",
      state: "proposed",
    },
    {
      id: "review-route",
      kind: "routing_policy",
      state: "proposed",
      rules: [
        {
          conditionLabel: "Changes requested",
          when: [
            {
              field: "review_outcome",
              operator: "equals",
              value: "changes_requested",
            },
          ],
          routeTo: "implement-change",
        },
        {
          conditionLabel: "Accepted",
          when: [
            {
              field: "review_outcome",
              operator: "equals",
              value: "accepted",
            },
          ],
          routeTo: "issue-update",
        },
        {
          conditionLabel: "Blocked or unclear",
          when: [
            {
              field: "review_outcome",
              operator: "equals",
              value: "blocked",
            },
          ],
          routeTo: "issue-update",
        },
      ],
    },
    {
      id: "issue-update",
      kind: "agent_step",
      label: "Update issue status",
      description:
        "Record PR links, review state, blockers, rework needs, or completion in the issue system.",
      state: "proposed",
    },
    {
      id: "improvement-output",
      kind: "workflow_output",
      label: "Factory improvement notes",
      description:
        "Capture repeated blockers, missing issue fields, weak tests, or recurring review feedback for later instruction and process updates.",
      state: "proposed",
    },
  ],
  links: [
    {
      from: "issue-ready",
      to: "readiness-check",
      kind: "triggers",
    },
    {
      from: "readiness-check",
      to: "implement-change",
      kind: "hands_off_to",
    },
    {
      from: "implement-change",
      to: "pr-output",
      kind: "produces",
    },
    {
      from: "pr-output",
      to: "review-step",
      kind: "triggers",
    },
    {
      from: "review-step",
      to: "review-route",
      kind: "routes_to",
    },
    {
      from: "review-route",
      to: "implement-change",
      kind: "routes_to",
    },
    {
      from: "review-route",
      to: "issue-update",
      kind: "routes_to",
    },
    {
      from: "issue-update",
      to: "improvement-output",
      kind: "produces",
    },
  ],
  actions: [],
} satisfies DesignerBlueprintDocument;

const StoryDesignerSessionConversationEntries = [
  {
    id: "designer-session-user-1",
    turnId: "designer-session-turn-1",
    kind: "user-message",
    status: "completed",
    text: "Build a triage agent for incoming GitHub issues and Linear bugs.",
  },
  {
    id: "designer-session-assistant-1",
    turnId: "designer-session-turn-1",
    kind: "assistant-message",
    phase: null,
    status: "completed",
    text: [
      "I drafted the first blueprint on the canvas.",
      "",
      "The trigger nodes collect Linear and GitHub events, the normalize step prepares a single work item shape, and the routing policy decides whether to write the normal triage update or escalate an urgent item.",
    ].join("\n"),
  },
  {
    id: "designer-session-user-2",
    turnId: "designer-session-turn-2",
    kind: "user-message",
    status: "completed",
    text: "The routing step probably needs more detail before we build anything.",
  },
  {
    id: "designer-session-assistant-2",
    turnId: "designer-session-turn-2",
    kind: "assistant-message",
    phase: null,
    status: "completed",
    text: "Add comments directly on the blueprint nodes you want changed. I will use those comments as Designer-specific context in the next turn.",
  },
] satisfies readonly ChatEntry[];

const StoryDesignerSessionPendingBlueprintComments = [
  {
    id: "designer-session-routing-comment",
    body: "Split urgent customer escalations from ordinary severity labels so the routing policy does not over-escalate noisy issues.",
    itemId: "routing",
    itemKindLabel: "Routing policy",
    itemLabel: "Routing: Escalations",
  },
] satisfies readonly PendingSessionBlueprintComment[];

const StoryDesignerSessionLongPendingBlueprintComments = [
  {
    id: "designer-session-routing-long-comment",
    body: [
      "Separate the escalation route from the normal triage update.",
      "Urgent customer-facing issues should page the support owner, while ordinary high-priority labels should stay in the normal review queue with a suggested owner and summary.",
    ].join("\n\n"),
    itemId: "routing",
    itemKindLabel: "Routing policy",
    itemLabel: "Routing: Escalations",
  },
] satisfies readonly PendingSessionBlueprintComment[];

const StoryDesignerSessionComposerStateInput = createReadySessionComposerStateInput({
  repositoryStatus: {
    branchLabel: "designer/triage-agent",
    pullRequest: null,
  },
});

function isStoryDesignerBlueprintCanvasTab(
  tab: DesignerSession["canvasTabs"][number],
): tab is StoryDesignerBlueprintCanvasTab {
  return tab.kind === "blueprint";
}

function getStoryDesignerBlueprintCanvasTabs(): readonly StoryDesignerBlueprintCanvasTab[] {
  return (StoryDesignerSessions[0]?.canvasTabs ?? []).filter(isStoryDesignerBlueprintCanvasTab);
}

function DesignerCanvasStoryRuntime(input: { children: React.ReactNode }): React.JSX.Element {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{input.children}</MemoryRouter>
    </QueryClientProvider>
  );
}

function DesignerPageStory(input: {
  createErrorMessage?: string | null;
  initialDraft?: string;
  isCreating?: boolean;
  sessions?: readonly DesignerSessionListItem[];
  sessionsErrorMessage?: string | null;
}): React.JSX.Element {
  const [prompt, setPrompt] = useState(input.initialDraft ?? "");

  return (
    <MemoryRouter initialEntries={["/"]}>
      <DesignerPageView
        createErrorMessage={input.createErrorMessage ?? null}
        isCreating={input.isCreating ?? false}
        onPromptChange={setPrompt}
        onSubmit={() => {}}
        prompt={prompt}
        sessions={input.sessions ?? StoryDesignerSessions}
        sessionsErrorMessage={input.sessionsErrorMessage ?? null}
      />
    </MemoryRouter>
  );
}

function DesignerSessionWithCanvasStory(input?: {
  initialPendingBlueprintComments?: readonly PendingSessionBlueprintComment[];
}): React.JSX.Element {
  const blueprintTab = getStoryDesignerBlueprintCanvasTabs()[0];
  const blueprintCommentState = useDesignerBlueprintCommentStoryState({
    initialPendingBlueprintComments:
      input?.initialPendingBlueprintComments ?? StoryDesignerSessionPendingBlueprintComments,
  });

  if (blueprintTab === undefined) {
    throw new Error("Designer blueprint story tab is missing.");
  }

  return (
    <DesignerCanvasStoryRuntime>
      {renderSessionWorkbenchContentStory({
        isSecondaryPanelVisible: true,
        mainContent: (
          <SessionConversationMainContent
            activeTurnId={null}
            autoScrollToBottomOnInitialLoad
            chatEntries={StoryDesignerSessionConversationEntries}
            initialBottomScrollResetKey="designer-session-with-canvas"
            isRespondingToServerRequest={false}
            isTurnInProgress={false}
            onRespondToServerRequest={noopRespondToServerRequest}
            pendingTurnId={null}
            serverRequestPanelEntries={[]}
          />
        ),
        primaryBottomPanel: (
          <SessionConversationBottomPanelDraftController
            clearPendingBlueprintComments={blueprintCommentState.clearBlueprintComments}
            clearPendingDiffComments={function clearPendingDiffComments() {}}
            composerStateInput={StoryDesignerSessionComposerStateInput}
            draftResetKey="designer-session-with-canvas"
            isRespondingToServerRequest={false}
            onRespondToServerRequest={noopRespondToServerRequest}
            pendingBlueprintComments={blueprintCommentState.pendingBlueprintComments}
            pendingDiffComments={[]}
            serverRequestPanelEntries={[]}
          />
        ),
        secondaryPanel: (
          <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
            <div className="flex h-10 flex-none items-center border-b bg-background px-3 text-sm font-medium">
              {blueprintTab.title}
            </div>
            <DesignerBlueprintCanvasPanel
              blueprint={blueprintTab.blueprint}
              onAddComment={blueprintCommentState.addBlueprintComment}
              onDeleteComment={blueprintCommentState.deleteBlueprintComment}
              onUpdateComment={blueprintCommentState.updateBlueprintComment}
              pendingComments={blueprintCommentState.pendingBlueprintComments}
            />
          </div>
        ),
        secondaryPanelMinSize: "35%",
        secondaryPanelDefaultSize: 58,
      })}
    </DesignerCanvasStoryRuntime>
  );
}

function AiSoftwareFactoryBlueprintStory(): React.JSX.Element {
  return (
    <DesignerCanvasStoryRuntime>
      <BlueprintCanvasStoryPanel title="AI software factory blueprint">
        <DesignerBlueprintCanvasPanel
          blueprint={AiSoftwareFactoryBlueprint}
          onAddComment={function onAddComment() {}}
          onDeleteComment={function onDeleteComment() {}}
          onUpdateComment={function onUpdateComment() {}}
          pendingComments={[]}
        />
      </BlueprintCanvasStoryPanel>
    </DesignerCanvasStoryRuntime>
  );
}

function BlueprintCanvasStoryPanel(input: {
  children: React.ReactNode;
  title: string;
}): React.JSX.Element {
  return (
    <section className="flex h-screen min-h-0 flex-col overflow-hidden bg-background">
      <div className="flex h-10 flex-none items-center border-b bg-background px-3 text-sm font-medium">
        {input.title}
      </div>
      <div className="min-h-0 flex-1">{input.children}</div>
    </section>
  );
}

function DesignerSessionCanvasFirstOpenStory(): React.JSX.Element {
  const blueprintTab = getStoryDesignerBlueprintCanvasTabs()[0];
  const [tabs, setTabs] = useState<readonly DesignerSession["canvasTabs"][number][]>([]);
  const [activeTabHref, setActiveTabHref] = useState<string | null>(null);

  if (blueprintTab === undefined) {
    throw new Error("Designer blueprint story tab is missing.");
  }

  const availableBlueprintTab = blueprintTab;

  function openBlueprint(): void {
    setTabs([availableBlueprintTab]);
    setActiveTabHref(DesignerBlueprintCurrentTabHref);
  }

  function closeBlueprint(): void {
    setTabs([]);
    setActiveTabHref(null);
  }

  function removeCanvasTab(tabId: string): void {
    setTabs((currentTabs) => currentTabs.filter((tab) => tab.id !== tabId));
    setActiveTabHref(null);
  }

  function updateCanvasTabs(nextTabs: readonly DesignerSession["canvasTabs"][number][]): void {
    setTabs([...nextTabs]);
  }

  return (
    <DesignerCanvasStoryRuntime>
      <div className="h-screen min-h-0 overflow-hidden">
        <SessionWorkbenchPageView
          alert={null}
          bottomPanel={<></>}
          isBottomPanelVisible={false}
          isSecondaryPanelVisible={tabs.length > 0}
          mainContent={
            <div className="flex h-full min-h-0 items-start justify-end p-4">
              <div className="flex gap-2">
                <Button onClick={openBlueprint} size="sm" type="button">
                  Open blueprint
                </Button>
                <Button onClick={closeBlueprint} size="sm" type="button" variant="outline">
                  Reset
                </Button>
              </div>
            </div>
          }
          mainContentLayout={{ scroll: "contained", width: "full" }}
          primaryBottomPanel={
            <SessionConversationBottomPanelDraftController
              clearPendingBlueprintComments={function clearPendingBlueprintComments() {}}
              clearPendingDiffComments={function clearPendingDiffComments() {}}
              composerStateInput={StoryDesignerSessionComposerStateInput}
              draftResetKey="designer-session-canvas-first-open"
              isRespondingToServerRequest={false}
              onRespondToServerRequest={noopRespondToServerRequest}
              pendingBlueprintComments={[]}
              pendingDiffComments={[]}
              serverRequestPanelEntries={[]}
            />
          }
          primaryPanelDefaultSize={40}
          sandboxInstanceId="sbi_designer_canvas_first_open_story"
          secondaryPanel={
            <div className="h-full min-h-0 min-w-0 overflow-hidden bg-background">
              <main className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
                <DesignerCanvasWorkspace
                  activeTabHref={activeTabHref}
                  designerSessionId="designer_session_canvas_first_open_story"
                  mountDockviewWhenEmpty
                  onAddBlueprintComment={function onAddBlueprintComment() {}}
                  onActiveTabHrefChange={setActiveTabHref}
                  onDeleteBlueprintComment={function onDeleteBlueprintComment() {}}
                  onTabClose={removeCanvasTab}
                  onTabsChange={updateCanvasTabs}
                  onUpdateBlueprintComment={function onUpdateBlueprintComment() {}}
                  pendingBlueprintComments={[]}
                  tabs={tabs}
                />
              </main>
            </div>
          }
          secondaryPanelDefaultSize={60}
          secondaryPanelFirstOpenTransitionMode="slow"
          secondaryPanelLayoutKey="designer-canvas-first-open-story"
          secondaryPanelMinSize="20rem"
          secondaryPanelMountMode="persistent-collapsible"
          secondaryPanelResizeKey={tabs.length === 0 ? null : "designer-canvas-open"}
        />
      </div>
    </DesignerCanvasStoryRuntime>
  );
}

function useDesignerBlueprintCommentStoryState(input: {
  initialPendingBlueprintComments: readonly PendingSessionBlueprintComment[];
}): {
  addBlueprintComment: (comment: PendingSessionBlueprintCommentInput) => void;
  clearBlueprintComments: () => void;
  deleteBlueprintComment: (commentId: string) => void;
  pendingBlueprintComments: readonly PendingSessionBlueprintComment[];
  updateBlueprintComment: (commentId: string, body: string) => void;
} {
  const [pendingBlueprintComments, setPendingBlueprintComments] = useState<
    readonly PendingSessionBlueprintComment[]
  >(() => input.initialPendingBlueprintComments);

  const addBlueprintComment = useCallback((comment: PendingSessionBlueprintCommentInput) => {
    setPendingBlueprintComments((currentComments) => [
      {
        ...comment,
        id: `designer-session-${comment.itemId}-comment`,
      },
      ...currentComments.filter((currentComment) => currentComment.itemId !== comment.itemId),
    ]);
  }, []);

  const deleteBlueprintComment = useCallback((commentId: string) => {
    setPendingBlueprintComments((currentComments) =>
      currentComments.filter((comment) => comment.id !== commentId),
    );
  }, []);

  const updateBlueprintComment = useCallback((commentId: string, body: string) => {
    setPendingBlueprintComments((currentComments) =>
      currentComments.map((comment) =>
        comment.id === commentId
          ? {
              ...comment,
              body,
            }
          : comment,
      ),
    );
  }, []);

  const clearBlueprintComments = useCallback(() => {
    setPendingBlueprintComments([]);
  }, []);

  return {
    addBlueprintComment,
    clearBlueprintComments,
    deleteBlueprintComment,
    pendingBlueprintComments,
    updateBlueprintComment,
  };
}

function BlueprintCommentStateGalleryStory(): React.JSX.Element {
  const [draftBody, setDraftBody] = useState(
    "Can we make this branch explicit before implementation?",
  );

  return (
    <DesignerCanvasStoryRuntime>
      <div className="min-h-screen bg-muted/20 p-6 text-foreground">
        <div className="grid gap-8 lg:grid-cols-2">
          <BlueprintCommentStatePreview floating={false} title="Collapsed pending comment">
            <DesignerBlueprintCollapsedCommentButton
              label="Open blueprint comment for Routing: Escalations"
              onOpen={function onOpen() {}}
            />
          </BlueprintCommentStatePreview>
          <BlueprintCommentStatePreview title="Pending comment">
            <DesignerBlueprintPendingCommentEditor
              body={StoryDesignerSessionPendingBlueprintComments[0]?.body ?? ""}
              onBodyChange={function onBodyChange() {}}
              onCollapse={function onCollapse() {}}
              onDelete={function onDelete() {}}
              title="Pending comment"
            />
          </BlueprintCommentStatePreview>
          <BlueprintCommentStatePreview title="Long pending comment">
            <DesignerBlueprintPendingCommentEditor
              body={StoryDesignerSessionLongPendingBlueprintComments[0]?.body ?? ""}
              onBodyChange={function onBodyChange() {}}
              onCollapse={function onCollapse() {}}
              onDelete={function onDelete() {}}
              title="Pending comment"
            />
          </BlueprintCommentStatePreview>
          <BlueprintCommentStatePreview title="Draft comment">
            <DesignerBlueprintDraftCommentEditor
              body={draftBody}
              onBodyChange={setDraftBody}
              onCancel={function onCancel() {}}
              onSubmit={function onSubmit() {}}
            />
          </BlueprintCommentStatePreview>
          <BlueprintCommentStatePreview title="Empty draft">
            <DesignerBlueprintDraftCommentEditor
              body=""
              onBodyChange={function onBodyChange() {}}
              onCancel={function onCancel() {}}
              onSubmit={function onSubmit() {}}
            />
          </BlueprintCommentStatePreview>
        </div>
      </div>
    </DesignerCanvasStoryRuntime>
  );
}

function BlueprintCommentStatePreview(input: {
  children: React.ReactNode;
  floating?: boolean | undefined;
  title: string;
}): React.JSX.Element {
  return (
    <section className="min-w-0">
      <h2 className="mb-3 text-sm font-medium text-muted-foreground">{input.title}</h2>
      <div className="relative h-56 min-w-[620px] rounded-md border border-border bg-background/70 p-4">
        <div className="relative w-[280px]">
          <div className="rounded-md border border-border bg-background p-2.5 shadow-sm">
            <div className="flex items-start gap-2.5">
              <span className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-sm border border-border bg-muted text-muted-foreground">
                <span className="size-3 rounded-full bg-muted-foreground/50" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2.5 rounded-sm bg-muted/45 px-2.5 py-1.5 text-sm">
                  <span className="rounded-sm border border-border bg-background px-1.5 py-0.5 text-xs font-medium uppercase text-muted-foreground">
                    If
                  </span>
                  <span className="truncate font-medium">Escalations</span>
                </div>
              </div>
            </div>
          </div>
          {input.floating === false ? (
            input.children
          ) : (
            <DesignerBlueprintFloatingComment className="absolute left-[calc(100%+0.75rem)] top-0 z-20">
              {input.children}
            </DesignerBlueprintFloatingComment>
          )}
        </div>
      </div>
    </section>
  );
}

function DesignerCanvasWorkspaceStory(input: {
  tabs: readonly DesignerSession["canvasTabs"][number][];
  activeTabHref?: string;
}): React.JSX.Element {
  const [tabs, setTabs] = useState([...input.tabs]);
  const [activeTabHref, setActiveTabHref] = useState<string | null>(
    input.activeTabHref ?? tabs[0]?.href ?? null,
  );

  return (
    <DesignerCanvasStoryRuntime>
      <DesignerCanvasWorkspace
        activeTabHref={activeTabHref}
        designerSessionId="designer_session_canvas_story"
        onAddBlueprintComment={function onAddBlueprintComment() {}}
        onActiveTabHrefChange={setActiveTabHref}
        onDeleteBlueprintComment={function onDeleteBlueprintComment() {}}
        onTabClose={(tabId) => {
          setTabs((currentTabs) => currentTabs.filter((tab) => tab.id !== tabId));
        }}
        onTabsChange={(nextTabs) => {
          setTabs([...nextTabs]);
        }}
        onUpdateBlueprintComment={function onUpdateBlueprintComment() {}}
        pendingBlueprintComments={[]}
        tabs={tabs}
      />
    </DesignerCanvasStoryRuntime>
  );
}

function getIntegrationDefinitionOrThrow(input: {
  familyId: string;
  variantId: string;
}): AnyIntegrationDefinition {
  const definition = IntegrationRegistry.getDefinition(input);
  if (definition === null || definition === undefined) {
    throw new Error(
      `Missing integration definition '${input.familyId}/${input.variantId}' for Storybook.`,
    );
  }

  return definition;
}

function createDesignerStoryIntegrationTarget(input: {
  familyId: string;
  variantId: string;
}): IntegrationTarget {
  const definition = getIntegrationDefinitionOrThrow(input);

  return {
    targetKey: definition.variantId,
    familyId: definition.familyId,
    variantId: definition.variantId,
    kind: definition.kind,
    enabled: true,
    config: {},
    displayName: definition.displayName,
    description: definition.description ?? "",
    ...(definition.logoKey === undefined ? {} : { logoKey: definition.logoKey }),
    connectionMethods: createStoryConnectionMethods(definition),
    targetHealth: {
      configStatus: "valid",
    },
  };
}

const DesignerStoryOpenAiTarget = createDesignerStoryIntegrationTarget({
  familyId: "openai",
  variantId: "openai-default",
});

const DesignerStoryWasenderApiTarget = createDesignerStoryIntegrationTarget({
  familyId: "wasenderapi",
  variantId: "wasenderapi-mcp",
});

const DesignerStoryCompletedWasenderApiConnection: IntegrationConnection = {
  id: "icn_wasenderapi_story_complete",
  targetKey: "wasenderapi-mcp",
  displayName: "WasenderAPI Production",
  status: "active",
  connectionMethodId: "api-key",
  connectionMethodLabel: "Personal access token",
  config: {
    connection_method: "api-key",
    provider_configuration_setup_completed: "true",
  },
  configuredSecretNames: ["personalAccessToken", "webhookSecret"],
  createdAt: "2026-06-21T00:00:00.000Z",
  updatedAt: "2026-06-21T00:00:00.000Z",
};

function createDesignerIntegrationSetupStoryQueryClient(): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: Infinity,
        refetchOnMount: false,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: Infinity,
      },
    },
  });

  queryClient.setQueryData(SETTINGS_INTEGRATIONS_QUERY_KEY, {
    targets: [DesignerStoryOpenAiTarget, DesignerStoryWasenderApiTarget],
    connections: [DesignerStoryCompletedWasenderApiConnection],
  });
  queryClient.setQueryData(SESSION_QUERY_KEY, {
    session: {
      activeOrganizationId: "org_story",
    },
  });
  queryClient.setQueryData(organizationSummaryQueryKey("org_story"), {
    name: "Mistle",
  });

  return queryClient;
}

const DesignerIntegrationSetupTabs: DesignerSession["canvasTabs"] = [
  {
    kind: "route",
    id: "openai-create",
    title: "Add OpenAI",
    href: "/integrations/openai-default/add",
  },
  {
    kind: "route",
    id: "wasenderapi-setup-complete",
    title: "WasenderAPI Setup",
    href: "/integrations/wasenderapi-mcp/icn_wasenderapi_story_complete/provider-configuration/setup",
  },
];

function DesignerIntegrationSetupCanvasStory(input: { activeTabHref: string }): React.JSX.Element {
  const [queryClient] = useState(createDesignerIntegrationSetupStoryQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <DesignerCanvasWorkspaceStory
        activeTabHref={input.activeTabHref}
        tabs={DesignerIntegrationSetupTabs}
      />
    </QueryClientProvider>
  );
}

/**
 * Review the Designer session list and canvas workspace, including dashboard-owned setup routes
 * embedded as canvas tabs. The integration setup stories show that setup appears in the canvas,
 * not above the composer, and that completed setup remains visible until the user closes the tab.
 */
const meta = {
  title: "Dashboard/Home/Page",
  component: DesignerPageView,
  args: {
    createErrorMessage: null,
    isCreating: false,
    onPromptChange: () => {},
    onSubmit: () => {},
    prompt: "Build a triaging agent for Linear and GitHub.",
    sessions: StoryDesignerSessions,
    sessionsErrorMessage: null,
  },
  parameters: {
    layout: "fullscreen",
  },
  decorators: [withDashboardPageStory],
  render: function RenderStory(): React.JSX.Element {
    return <DesignerPageStory initialDraft="Build a triaging agent for Linear and GitHub." />;
  },
} satisfies Meta<typeof DesignerPageView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const WithSessions: Story = {
  render: function RenderWithSessionsStory(): React.JSX.Element {
    return <DesignerPageStory />;
  },
};

export const Empty: Story = {
  render: function RenderEmptyStory(): React.JSX.Element {
    return <DesignerPageStory sessions={[]} />;
  },
};

export const CreateError: Story = {
  render: function RenderCreateErrorStory(): React.JSX.Element {
    return (
      <DesignerPageStory
        createErrorMessage="Designer sessions require the Docker sandbox runtime in this first implementation."
        initialDraft="Build an incident response agent."
      />
    );
  },
};

export const Canvas: Story = {
  decorators: [withDashboardWorkspaceStory],
  render: function RenderCanvasStory(): React.JSX.Element {
    return <DesignerCanvasWorkspaceStory tabs={getStoryDesignerBlueprintCanvasTabs()} />;
  },
};

export const SessionWithCanvas: Story = {
  parameters: {
    customWorkbenchStory: true,
  },
  render: function RenderSessionWithCanvasStory(): React.JSX.Element {
    return <DesignerSessionWithCanvasStory />;
  },
};

export const CanvasFirstOpen: Story = {
  decorators: [withDashboardWorkspaceStory],
  parameters: {
    customWorkbenchStory: true,
  },
  render: function RenderCanvasFirstOpenStory(): React.JSX.Element {
    return <DesignerSessionCanvasFirstOpenStory />;
  },
};

export const SessionWithCanvasNoComments: Story = {
  parameters: {
    customWorkbenchStory: true,
  },
  render: function RenderSessionWithCanvasNoCommentsStory(): React.JSX.Element {
    return <DesignerSessionWithCanvasStory initialPendingBlueprintComments={[]} />;
  },
};

export const SessionWithCanvasLongComment: Story = {
  parameters: {
    customWorkbenchStory: true,
  },
  render: function RenderSessionWithCanvasLongCommentStory(): React.JSX.Element {
    return (
      <DesignerSessionWithCanvasStory
        initialPendingBlueprintComments={StoryDesignerSessionLongPendingBlueprintComments}
      />
    );
  },
};

export const BlueprintCommentStates: Story = {
  render: function RenderBlueprintCommentStatesStory(): React.JSX.Element {
    return <BlueprintCommentStateGalleryStory />;
  },
};

export const AiSoftwareFactoryBlueprintLayout: Story = {
  render: function RenderAiSoftwareFactoryBlueprintStory(): React.JSX.Element {
    return <AiSoftwareFactoryBlueprintStory />;
  },
};

export const EmptyCanvas: Story = {
  decorators: [withDashboardWorkspaceStory],
  render: function RenderEmptyCanvasStory(): React.JSX.Element {
    return <DesignerCanvasWorkspaceStory tabs={[]} />;
  },
};

export const CanvasIntegrationCreate: Story = {
  decorators: [withDashboardWorkspaceStory],
  render: function RenderCanvasIntegrationCreateStory(): React.JSX.Element {
    return <DesignerIntegrationSetupCanvasStory activeTabHref="/integrations/openai-default/add" />;
  },
};

export const CanvasIntegrationSetupComplete: Story = {
  decorators: [withDashboardWorkspaceStory],
  render: function RenderCanvasIntegrationSetupCompleteStory(): React.JSX.Element {
    return (
      <DesignerIntegrationSetupCanvasStory activeTabHref="/integrations/wasenderapi-mcp/icn_wasenderapi_story_complete/provider-configuration/setup" />
    );
  },
};
