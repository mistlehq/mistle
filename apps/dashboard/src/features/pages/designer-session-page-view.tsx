import { Badge } from "@mistle/ui";

import "dockview/dist/styles/dockview.css";
import "./session-terminal-workspace.css";
import {
  DockviewReact,
  type DockviewApi,
  type DockviewWillShowOverlayLocationEvent,
  type DockviewWillDropEvent,
  type IDockviewPanelProps,
} from "dockview";
import type { FunctionComponent } from "react";

import { ErrorNotice } from "../auth/error-notice.js";
import type { ChatEntry } from "../chat/chat-types.js";
import type { ChatComposerStatusMessage } from "../chat/components/chat-composer.js";
import type {
  DesignerActionProposal,
  DesignerActionProposalResponse,
  DesignerRuntimeConversationBootstrap,
  DesignerRuntimeConversationTranscript,
  DesignerSession,
} from "../designer/designer-service.js";
import { hydrateCodexChatEntriesFromThreadReadTurns } from "../session-agents/codex/session-state/index.js";
import { AutoSaveTitleHeading } from "../shared/auto-save-inline-heading.js";
import { ConversationWorkspaceHeader } from "../shared/conversation-workspace-frame.js";
import { formatDesignerActionRequestOperationResult } from "./designer-action-proposal-response-copy.js";
import { SandboxOperationProgress } from "./sandbox-operation-progress.js";
import { resolveSandboxStatusBadgeUi } from "./sandbox-status-presentation.js";
import { createComposerDraft } from "./session-composer/session-composer-draft.js";
import {
  SessionConversationBottomPanel,
  SessionConversationMainContent,
} from "./session-conversation-pane.js";
import { SessionStartupStatus, type SessionStartupState } from "./session-startup-status.js";
import { SessionWorkbenchPageView } from "./session-workbench-page-view.js";
import { resolveInitialEntryStartupState } from "./use-session-workbench-lifecycle-state.js";

type DesignerCanvasTab = DesignerSession["canvasTabs"][number];

type DesignerCanvasDockviewParams = {
  href: string;
};

type DesignerCanvasDockviewPanelProps = IDockviewPanelProps<DesignerCanvasDockviewParams>;

export type DesignerSessionPageViewProps = {
  actionProposalResponseErrorMessage: string | null;
  actionProposalResponsePendingId: string | null;
  actionProposalResponseSuccessMessage: string | null;
  bootstrapErrorMessage: string | null;
  bootstrapIsPending: boolean;
  errorMessage: string | null;
  followUpDraft: string;
  followUpErrorMessage: string | null;
  followUpIsPending: boolean;
  followUpSuccessMessage: string | null;
  onActionProposalResponseSubmit: (
    proposalId: string,
    response: DesignerActionProposalResponse,
  ) => void;
  onFollowUpDraftChange: (draft: string) => void;
  onFollowUpSubmit: () => void;
  onTitleSave: (title: string) => Promise<void> | void;
  onUserInputRequestResponseSubmit: (requestId: string | number, result: unknown) => void;
  runtimeConversationBootstrap: DesignerRuntimeConversationBootstrap | null;
  runtimeConversationTranscript: DesignerRuntimeConversationTranscript | null;
  transcriptErrorMessage: string | null;
  transcriptIsPending: boolean;
  userInputRequestResponseErrorMessage: string | null;
  userInputRequestResponseIsPending: boolean;
  userInputRequestResponsePendingId: string | number | null;
  session: DesignerSession | null;
  sessionId: string;
};

function RuntimeConversationPreview(input: {
  followUpDraft: string;
  followUpErrorMessage: string | null;
  followUpIsPending: boolean;
  followUpSuccessMessage: string | null;
  actionProposalResponseErrorMessage: string | null;
  actionProposalResponsePendingId: string | null;
  actionProposalResponseSuccessMessage: string | null;
  onActionProposalResponseSubmit: (
    proposalId: string,
    response: DesignerActionProposalResponse,
  ) => void;
  onFollowUpDraftChange: (draft: string) => void;
  onFollowUpSubmit: () => void;
  onUserInputRequestResponseSubmit: (requestId: string | number, result: unknown) => void;
  runtimeConversationBootstrap: DesignerRuntimeConversationBootstrap | null;
  runtimeConversationTranscript: DesignerRuntimeConversationTranscript | null;
  session: DesignerSession | null;
  transcriptErrorMessage: string | null;
  transcriptIsPending: boolean;
  userInputRequestResponseErrorMessage: string | null;
  userInputRequestResponseIsPending: boolean;
  userInputRequestResponsePendingId: string | number | null;
}): React.JSX.Element | null {
  const initialPrompt = input.session?.initialPrompt ?? null;
  if (initialPrompt === null) {
    return null;
  }

  const canSubmitFollowUp =
    input.runtimeConversationBootstrap !== null &&
    input.followUpDraft.trim().length > 0 &&
    !input.followUpIsPending;
  const chatEntries = resolveDesignerChatEntries({
    initialPrompt,
    runtimeConversationBootstrap: input.runtimeConversationBootstrap,
    runtimeConversationTranscript: input.runtimeConversationTranscript,
  });
  const serverRequestPanelEntries = (
    input.runtimeConversationTranscript?.userInputRequests ?? []
  ).map((entry) => {
    const isPendingResponse =
      input.userInputRequestResponsePendingId !== null &&
      String(entry.requestId) === String(input.userInputRequestResponsePendingId);

    return {
      ...entry,
      responseErrorMessage: isPendingResponse
        ? input.userInputRequestResponseErrorMessage
        : entry.responseErrorMessage,
      status:
        input.userInputRequestResponseIsPending && isPendingResponse ? "responding" : entry.status,
    };
  });
  const statusMessage = resolveDesignerComposerStatusMessage({
    followUpErrorMessage: input.followUpErrorMessage,
    followUpSuccessMessage: input.followUpSuccessMessage,
    transcriptErrorMessage: input.transcriptErrorMessage,
    transcriptIsPending: input.transcriptIsPending,
  });

  return (
    <>
      <div
        aria-label="Designer conversation"
        className="mr-2 min-h-0 flex-1 overflow-y-auto px-4 py-4"
        role="region"
        style={{ scrollbarGutter: "stable" }}
      >
        <SessionConversationMainContent
          activeTurnId={null}
          autoScrollToBottomOnInitialLoad
          chatEntries={chatEntries}
          formatInitialUserMessageAsTriggerInput
          isRespondingToServerRequest={input.userInputRequestResponseIsPending}
          isTurnInProgress={input.followUpIsPending || input.transcriptIsPending}
          onRespondToServerRequest={input.onUserInputRequestResponseSubmit}
          pendingTurnId={null}
          scrollBehavior="follow-streaming-at-bottom"
          serverRequestPanelEntries={serverRequestPanelEntries}
        />
        <DesignerActionProposals
          errorMessage={input.actionProposalResponseErrorMessage}
          onSubmitResponse={input.onActionProposalResponseSubmit}
          pendingProposalId={input.actionProposalResponsePendingId}
          proposals={input.runtimeConversationTranscript?.actionProposals ?? []}
          successMessage={input.actionProposalResponseSuccessMessage}
        />
      </div>
      <div className="bg-background px-4 py-3">
        <SessionConversationBottomPanel
          chatEntries={chatEntries}
          composerViewModel={{
            canUploadAttachments: false,
            composerCapabilities: [],
            composerDraft: createComposerDraft(input.followUpDraft),
            configControlsDisabled: true,
            contextUsage: null,
            gitBranchLabel: null,
            isSubmitPending: input.followUpIsPending,
            isUploadingAttachments: false,
            modelOptions: [],
            onClearPendingDiffComments: ignoreDesignerComposerAction,
            onComposerDraftChange: (draft) => {
              input.onFollowUpDraftChange(draft.text);
            },
            onModelChange: ignoreDesignerComposerAction,
            onPendingFilesAdded: ignoreDesignerComposerAction,
            onReasoningEffortChange: ignoreDesignerComposerAction,
            onRemovePendingAttachment: ignoreDesignerComposerAction,
            onRuntimeCommandSubmit: ignoreDesignerComposerAction,
            onSubmit: input.onFollowUpSubmit,
            pendingAttachments: [],
            pendingDiffCommentSummary: null,
            placeholderText: "Ask Designer to continue refining this setup.",
            pullRequest: null,
            reasoningEffortOptions: [],
            selectedModel: null,
            selectedReasoningEffort: null,
            showAttachmentControl: false,
            showConfigControls: false,
            showReasoningControl: false,
            submitDisabled: !canSubmitFollowUp,
            submitDisabledReason:
              input.runtimeConversationBootstrap === null
                ? "Runtime conversation must be ready before follow-up submission."
                : "Write a follow-up first.",
            submitLabel: input.followUpIsPending ? "Submitting follow-up" : "Submit follow-up",
            submitMode: "start",
          }}
          isRespondingToServerRequest={input.userInputRequestResponseIsPending}
          onRespondToServerRequest={input.onUserInputRequestResponseSubmit}
          serverRequestPanelEntries={serverRequestPanelEntries}
          statusMessage={statusMessage}
          showWorkingIndicator={input.followUpIsPending || input.transcriptIsPending}
        />
      </div>
    </>
  );
}

function ignoreDesignerComposerAction(): void {}

function resolveDesignerSessionStartupState(input: {
  runtimeConversationBootstrap: DesignerRuntimeConversationBootstrap | null;
  runtimeConversationTranscript: DesignerRuntimeConversationTranscript | null;
  session: DesignerSession | null;
  transcriptIsPending: boolean;
}): SessionStartupState | null {
  const runtimeConversationBootstrap = input.runtimeConversationBootstrap;
  const runtimeConversationIsReady =
    runtimeConversationBootstrap !== null &&
    input.runtimeConversationTranscript !== null &&
    !input.transcriptIsPending;
  const sessionSnapshot =
    runtimeConversationBootstrap !== null && runtimeConversationIsReady
      ? {
          connectedAtIso: runtimeConversationBootstrap.initialPromptSubmittedAt,
        }
      : null;

  return resolveInitialEntryStartupState({
    mainPanelTransitionState: runtimeConversationIsReady ? "stable_chat" : "restoring_chat",
    sandboxLifecycleStatus: input.session?.status ?? null,
    sandboxStatusReadState: input.session === null ? "loading" : "ready",
    sessionSnapshot,
  });
}

function DesignerSessionStartupPanel(input: {
  sandboxInstanceId: string | null;
  startupOperation: DesignerSession["startupOperation"] | null;
  startupState: SessionStartupState;
}): React.JSX.Element {
  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col justify-center gap-4 px-4 py-6">
      <SessionStartupStatus state={input.startupState} />
      <SandboxOperationProgress
        displayMode="timeline"
        emptyMessage="Waiting for session startup events."
        operationId={input.startupOperation?.operationId ?? null}
        sandboxInstanceId={input.sandboxInstanceId}
        showBorder
        showLoadError={false}
      />
    </div>
  );
}

function resolveDesignerChatEntries(input: {
  initialPrompt: string;
  runtimeConversationBootstrap: DesignerRuntimeConversationBootstrap | null;
  runtimeConversationTranscript: DesignerRuntimeConversationTranscript | null;
}): readonly ChatEntry[] {
  const transcriptEntries =
    input.runtimeConversationTranscript === null
      ? []
      : hydrateCodexChatEntriesFromThreadReadTurns(input.runtimeConversationTranscript.turns);
  if (transcriptEntries.length > 0) {
    return transcriptEntries;
  }

  return [
    {
      id: "designer-initial-prompt",
      turnId: input.runtimeConversationBootstrap?.providerExecutionId ?? "designer-initial-prompt",
      kind: "user-message",
      label: "You",
      text: input.initialPrompt,
      status: "completed",
    },
  ];
}

function resolveDesignerComposerStatusMessage(input: {
  followUpErrorMessage: string | null;
  followUpSuccessMessage: string | null;
  transcriptErrorMessage: string | null;
  transcriptIsPending: boolean;
}): ChatComposerStatusMessage | null {
  if (input.followUpErrorMessage !== null) {
    return {
      message: input.followUpErrorMessage,
      variant: "alert",
    };
  }

  if (input.transcriptErrorMessage !== null) {
    return {
      message: input.transcriptErrorMessage,
      variant: "alert",
    };
  }

  if (input.followUpSuccessMessage !== null) {
    return {
      message: input.followUpSuccessMessage,
      variant: "default",
      presentation: "notice",
    };
  }

  if (input.transcriptIsPending) {
    return {
      message: "Loading provider transcript...",
      variant: "default",
      presentation: "loading",
    };
  }

  return null;
}

function DesignerActionProposals(input: {
  errorMessage: string | null;
  onSubmitResponse: (proposalId: string, response: DesignerActionProposalResponse) => void;
  pendingProposalId: string | null;
  proposals: readonly DesignerActionProposal[];
  successMessage: string | null;
}): React.JSX.Element | null {
  if (input.proposals.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs font-medium text-muted-foreground">Action proposals</p>
      {input.proposals.map((proposal) => {
        const reviewRows = getDesignerActionProposalReviewRows(proposal.operation);

        return (
          <article className="rounded-lg border bg-muted/20 p-3" key={proposal.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-sm">{proposal.title}</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{proposal.summary}</p>
              </div>
              <Badge variant="secondary">
                {formatDesignerActionProposalStatus(proposal.status)}
              </Badge>
            </div>
            {reviewRows.length === 0 ? null : (
              <dl className="mt-3 grid gap-2 text-xs">
                {reviewRows.map((detail, detailIndex) => (
                  <div key={`${proposal.id}:${String(detailIndex)}:${detail.label}`}>
                    <dt className="text-muted-foreground">{detail.label}</dt>
                    <dd className="mt-0.5 whitespace-pre-wrap">{detail.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {proposal.actionRequest === null ? null : (
              <DesignerActionProposalDurableState actionRequest={proposal.actionRequest} />
            )}
            {proposal.status === "pending" ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  className="rounded-md border bg-background px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={input.pendingProposalId !== null}
                  onClick={() => {
                    input.onSubmitResponse(proposal.id, "declined");
                  }}
                  type="button"
                >
                  {input.pendingProposalId === proposal.id ? "Submitting" : "Decline"}
                </button>
                <button
                  className="rounded-md border bg-background px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={input.pendingProposalId !== null}
                  onClick={() => {
                    input.onSubmitResponse(proposal.id, "approved");
                  }}
                  type="button"
                >
                  {input.pendingProposalId === proposal.id ? "Submitting" : "Approve"}
                </button>
              </div>
            ) : null}
          </article>
        );
      })}
      <ErrorNotice message={input.errorMessage} />
      {input.successMessage === null ? null : (
        <p className="text-xs text-muted-foreground">{input.successMessage}</p>
      )}
    </div>
  );
}

function DesignerActionProposalDurableState(input: {
  actionRequest: NonNullable<DesignerActionProposal["actionRequest"]>;
}): React.JSX.Element {
  const resultLabel = formatDesignerActionRequestOperationResult(
    input.actionRequest.operationResult,
  );

  return (
    <div className="mt-3 rounded-md border bg-background/70 p-3">
      <p className="text-xs font-medium text-muted-foreground">Action request</p>
      <dl className="mt-2 grid gap-2 text-xs">
        <div>
          <dt className="text-muted-foreground">Request</dt>
          <dd className="mt-0.5 break-all font-mono">{input.actionRequest.id}</dd>
        </div>
        {resultLabel === null ? null : (
          <div>
            <dt className="text-muted-foreground">Result</dt>
            <dd className="mt-0.5">{resultLabel}</dd>
          </div>
        )}
        {input.actionRequest.failureCode === null ? null : (
          <div>
            <dt className="text-muted-foreground">Failure code</dt>
            <dd className="mt-0.5 break-all font-mono">{input.actionRequest.failureCode}</dd>
          </div>
        )}
        {input.actionRequest.failureMessage === null ? null : (
          <div>
            <dt className="text-muted-foreground">Failure</dt>
            <dd className="mt-0.5">{input.actionRequest.failureMessage}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

function getDesignerActionProposalReviewRows(
  operation: DesignerActionProposal["operation"],
): { label: string; value: string }[] {
  switch (operation.kind) {
    case "providerConfigurationChange":
      return operation.details.map((detail) => ({
        label: detail.label,
        value: detail.value,
      }));
    case "sandboxProfileDraftPublish":
      return [];
    case "sandboxProfileDraftSetupScriptPut":
      return [
        {
          label: "Setup script",
          value: operation.setupScript ?? "Clear setup script",
        },
      ];
    case "sandboxProfileVersionLaunch": {
      const primaryRepositoryId = operation.primaryRepositoryId;

      return primaryRepositoryId === null || primaryRepositoryId === undefined
        ? []
        : [
            {
              label: "Primary repository",
              value: primaryRepositoryId,
            },
          ];
    }
  }
}

function formatDesignerActionProposalStatus(status: DesignerActionProposal["status"]): string {
  switch (status) {
    case "pending":
      return "Review required";
    case "approved":
      return "Approved";
    case "declined":
      return "Declined";
    case "executing":
      return "Executing";
    case "execution_unsupported":
      return "Unsupported";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
  }
}

function readRequiredDesignerCanvasHref(parameters: unknown): string {
  if (typeof parameters !== "object" || parameters === null || Array.isArray(parameters)) {
    throw new Error("Designer canvas panel parameters must include href.");
  }

  const href = Reflect.get(parameters, "href");
  if (typeof href !== "string" || href.length === 0) {
    throw new Error("Designer canvas panel href must be a non-empty string.");
  }

  return href;
}

function DesignerCanvasDockviewPanel(input: DesignerCanvasDockviewPanelProps): React.JSX.Element {
  const href = readRequiredDesignerCanvasHref(input.params);

  return (
    <div className="flex h-full min-h-0 items-center justify-center bg-background p-4 text-sm text-muted-foreground">
      <span className="max-w-full truncate font-mono">{href}</span>
    </div>
  );
}

const DesignerCanvasDockviewComponents = {
  canvas: DesignerCanvasDockviewPanel,
} satisfies Record<string, FunctionComponent<DesignerCanvasDockviewPanelProps>>;

function preventDesignerCanvasLayoutDrop(event: DockviewWillDropEvent): void {
  if (event.kind === "tab" || event.kind === "header_space") {
    return;
  }

  event.preventDefault();
}

function preventDesignerCanvasLayoutOverlay(event: DockviewWillShowOverlayLocationEvent): void {
  if (event.kind === "tab" || event.kind === "header_space") {
    return;
  }

  event.preventDefault();
}

function buildDesignerCanvasWorkspaceKey(tabs: readonly DesignerCanvasTab[]): string {
  if (tabs.length === 0) {
    return "empty";
  }

  return tabs.map((tab) => tab.id).join(":");
}

function DesignerCanvasWorkspace(input: { tabs: readonly DesignerCanvasTab[] }): React.JSX.Element {
  if (input.tabs.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-background p-4 text-sm text-muted-foreground">
        Canvas
      </div>
    );
  }

  return (
    <div
      className="session-terminal-dockview dockview-theme-light min-h-0 min-w-0 flex-1 overflow-hidden"
      key={buildDesignerCanvasWorkspaceKey(input.tabs)}
    >
      <DockviewReact
        className="h-full"
        components={DesignerCanvasDockviewComponents}
        disableFloatingGroups
        dndEdges={false}
        onReady={(event: { api: DockviewApi }) => {
          event.api.onWillShowOverlay(preventDesignerCanvasLayoutOverlay);

          for (const tab of input.tabs) {
            event.api.addPanel({
              id: tab.id,
              title: tab.title,
              component: "canvas",
              params: {
                href: tab.href,
              },
              renderer: "always",
            });
          }
        }}
        onWillDrop={preventDesignerCanvasLayoutDrop}
      />
    </div>
  );
}

export function DesignerSessionPageView(input: DesignerSessionPageViewProps): React.JSX.Element {
  const statusUi = resolveSandboxStatusBadgeUi(input.session?.status ?? null);
  const canvasTabs = input.session?.canvasTabs ?? [];
  const startupState = resolveDesignerSessionStartupState({
    runtimeConversationBootstrap: input.runtimeConversationBootstrap,
    runtimeConversationTranscript: input.runtimeConversationTranscript,
    session: input.session,
    transcriptIsPending: input.transcriptIsPending,
  });

  const conversationPanel = (
    <aside className="flex h-full min-h-0 flex-col">
      <ConversationWorkspaceHeader
        actions={
          <span
            aria-label={statusUi.label}
            className={[
              "inline-block size-2.5 rounded-full border",
              statusUi.indicatorClassName,
            ].join(" ")}
            role="status"
            title={statusUi.label}
          />
        }
        title={
          <AutoSaveTitleHeading
            ariaLabel="Designer session title"
            disabled={input.session === null}
            emptyDisplayText="Untitled"
            inputClassName="truncate"
            maxWidthClassName="max-w-[28rem] flex-1"
            onSave={input.onTitleSave}
            requiredLabel="Designer session title"
            size="sm"
            value={input.session?.title ?? null}
          />
        }
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <ErrorNotice message={input.errorMessage} />
        {startupState === null ? (
          <RuntimeConversationPreview
            actionProposalResponseErrorMessage={input.actionProposalResponseErrorMessage}
            actionProposalResponsePendingId={input.actionProposalResponsePendingId}
            actionProposalResponseSuccessMessage={input.actionProposalResponseSuccessMessage}
            followUpDraft={input.followUpDraft}
            followUpErrorMessage={input.followUpErrorMessage}
            followUpIsPending={input.followUpIsPending}
            followUpSuccessMessage={input.followUpSuccessMessage}
            onActionProposalResponseSubmit={input.onActionProposalResponseSubmit}
            onFollowUpDraftChange={input.onFollowUpDraftChange}
            onFollowUpSubmit={input.onFollowUpSubmit}
            onUserInputRequestResponseSubmit={input.onUserInputRequestResponseSubmit}
            runtimeConversationBootstrap={input.runtimeConversationBootstrap}
            runtimeConversationTranscript={input.runtimeConversationTranscript}
            session={input.session}
            transcriptErrorMessage={input.transcriptErrorMessage}
            transcriptIsPending={input.transcriptIsPending}
            userInputRequestResponseErrorMessage={input.userInputRequestResponseErrorMessage}
            userInputRequestResponseIsPending={input.userInputRequestResponseIsPending}
            userInputRequestResponsePendingId={input.userInputRequestResponsePendingId}
          />
        ) : (
          <DesignerSessionStartupPanel
            sandboxInstanceId={input.session?.sandboxInstanceId ?? null}
            startupOperation={input.session?.startupOperation ?? null}
            startupState={startupState}
          />
        )}
      </div>
    </aside>
  );

  const canvasPanel = (
    <div className="h-full min-h-0 min-w-0 overflow-hidden bg-background">
      <main className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
        <DesignerCanvasWorkspace tabs={canvasTabs} />
      </main>
    </div>
  );

  return (
    <div className="h-svh min-h-0 overflow-hidden bg-background">
      <SessionWorkbenchPageView
        alert={null}
        bottomPanel={null}
        isBottomPanelVisible={false}
        isSecondaryPanelVisible
        mainContent={conversationPanel}
        mainContentLayout={{ scroll: "contained", width: "full" }}
        primaryBottomPanel={null}
        primaryPanelMinSize="22rem"
        sandboxInstanceId={input.sessionId}
        secondaryPanel={canvasPanel}
        secondaryPanelLayoutKey="designer-canvas"
        secondaryPanelMinSize="20rem"
      />
    </div>
  );
}
