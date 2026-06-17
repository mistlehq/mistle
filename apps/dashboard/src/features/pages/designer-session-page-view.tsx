import { SandboxInstanceStatuses } from "@mistle/sandbox-lifecycle";
import { Badge } from "@mistle/ui";

import { ErrorNotice } from "../auth/error-notice.js";
import { ChatComposer } from "../chat/components/chat-composer.js";
import { ChatThread } from "../chat/components/chat-thread.js";
import type {
  DesignerActionProposal,
  DesignerActionProposalResponse,
  DesignerRuntimeConversationBootstrap,
  DesignerRuntimeConversationTranscript,
  DesignerSession,
} from "../designer/designer-service.js";
import { hydrateCodexChatEntriesFromThreadReadTurns } from "../session-agents/codex/session-state/index.js";
import { createComposerDraft } from "./session-composer/session-composer-draft.js";

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
  runtimeConversationBootstrap: DesignerRuntimeConversationBootstrap | null;
  runtimeConversationTranscript: DesignerRuntimeConversationTranscript | null;
  transcriptErrorMessage: string | null;
  transcriptIsPending: boolean;
  session: DesignerSession | null;
  sessionId: string;
};

type RuntimeBootstrapStateProps = Pick<
  DesignerSessionPageViewProps,
  "bootstrapErrorMessage" | "bootstrapIsPending" | "runtimeConversationBootstrap" | "session"
>;

const StartingDesignerSessionStatuses = new Set<string>([
  SandboxInstanceStatuses.PENDING,
  SandboxInstanceStatuses.STARTING,
  SandboxInstanceStatuses.STARTED,
  SandboxInstanceStatuses.INITIALIZING,
  SandboxInstanceStatuses.DEGRADED,
  SandboxInstanceStatuses.RECONNECTING,
  SandboxInstanceStatuses.STOPPING,
]);

function resolveRuntimeBootstrapStatus(input: RuntimeBootstrapStateProps): {
  label: string;
  detail: string;
  tone: "default" | "muted" | "error";
} {
  if (input.bootstrapErrorMessage !== null) {
    return {
      label: "Runtime bootstrap failed",
      detail: input.bootstrapErrorMessage,
      tone: "error",
    };
  }

  if (input.runtimeConversationBootstrap !== null) {
    return {
      label: "Runtime conversation ready",
      detail: `Initial prompt submitted at ${input.runtimeConversationBootstrap.initialPromptSubmittedAt}.`,
      tone: "default",
    };
  }

  if (input.bootstrapIsPending) {
    return {
      label: "Preparing runtime conversation",
      detail: "Submitting the initial prompt to the Designer runtime.",
      tone: "muted",
    };
  }

  if (input.session === null) {
    return {
      label: "Loading Designer session",
      detail: "Runtime bootstrap starts after the session is available.",
      tone: "muted",
    };
  }

  if (input.session.initialPrompt === null) {
    return {
      label: "Initial prompt unavailable",
      detail: "Runtime bootstrap needs a saved initial prompt.",
      tone: "muted",
    };
  }

  if (
    !input.session.connectable &&
    input.session.status !== null &&
    StartingDesignerSessionStatuses.has(input.session.status)
  ) {
    return {
      label: "Waiting for runtime",
      detail: "Runtime bootstrap will start when the Designer sandbox is ready.",
      tone: "muted",
    };
  }

  if (input.session.status === null) {
    return {
      label: "Runtime unavailable",
      detail: input.session.failureMessage ?? "The Designer sandbox is not connectable.",
      tone: "muted",
    };
  }

  if (input.session.status === SandboxInstanceStatuses.FAILED) {
    return {
      label: "Runtime unavailable",
      detail: input.session.failureMessage ?? `The Designer sandbox is ${input.session.status}.`,
      tone: "muted",
    };
  }

  return {
    label: "Runtime bootstrap pending",
    detail: "Runtime bootstrap will start when the session is ready.",
    tone: "muted",
  };
}

function RuntimeBootstrapState(input: RuntimeBootstrapStateProps): React.JSX.Element {
  const status = resolveRuntimeBootstrapStatus(input);
  const className =
    status.tone === "error"
      ? "rounded-lg border border-destructive/30 bg-destructive/10 p-3"
      : "rounded-lg border bg-muted/20 p-3";

  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-muted-foreground">Runtime bootstrap</p>
        {input.runtimeConversationBootstrap === null ? null : (
          <Badge variant="secondary">ready</Badge>
        )}
      </div>
      <p className="mt-1 text-sm font-medium">{status.label}</p>
      <p className="mt-1 text-sm text-muted-foreground">{status.detail}</p>
      {input.runtimeConversationBootstrap === null ? null : (
        <dl className="mt-3 grid gap-2 text-xs">
          <div>
            <dt className="text-muted-foreground">Provider conversation</dt>
            <dd className="mt-0.5 break-all font-mono">
              {input.runtimeConversationBootstrap.providerConversationId}
            </dd>
          </div>
          {input.runtimeConversationBootstrap.providerExecutionId === null ? null : (
            <div>
              <dt className="text-muted-foreground">Initial prompt execution</dt>
              <dd className="mt-0.5 break-all font-mono">
                {input.runtimeConversationBootstrap.providerExecutionId}
              </dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}

function RuntimeConversationPreview(input: {
  bootstrapErrorMessage: string | null;
  bootstrapIsPending: boolean;
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
  runtimeConversationBootstrap: DesignerRuntimeConversationBootstrap | null;
  runtimeConversationTranscript: DesignerRuntimeConversationTranscript | null;
  session: DesignerSession | null;
  transcriptErrorMessage: string | null;
  transcriptIsPending: boolean;
}): React.JSX.Element | null {
  const initialPrompt = input.session?.initialPrompt ?? null;
  if (initialPrompt === null) {
    return null;
  }

  const promptState = resolveRuntimeConversationPromptState(input);
  const canSubmitFollowUp =
    input.runtimeConversationBootstrap !== null &&
    input.followUpDraft.trim().length > 0 &&
    !input.followUpIsPending;
  const chatEntries =
    input.runtimeConversationTranscript === null
      ? []
      : hydrateCodexChatEntriesFromThreadReadTurns(input.runtimeConversationTranscript.turns);

  return (
    <section className="rounded-lg border bg-background">
      <div className="border-b px-3 py-2">
        <p className="text-xs font-medium text-muted-foreground">Runtime conversation</p>
      </div>
      <div className="p-3">
        {chatEntries.length > 0 ? (
          <div className="max-h-[calc(100svh-20rem)] overflow-y-auto pr-1">
            <ChatThread
              entries={chatEntries}
              formatInitialUserMessageAsTriggerInput
              isRespondingToServerRequest={false}
              onRespondToServerRequest={ignoreDesignerServerRequest}
              pendingServerRequests={[]}
            />
          </div>
        ) : (
          <div className="rounded-md bg-muted/40 p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium text-muted-foreground">You</p>
              <Badge variant="secondary">{promptState.label}</Badge>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm">{initialPrompt}</p>
            <p className="mt-2 text-xs text-muted-foreground">{promptState.detail}</p>
            {input.runtimeConversationBootstrap?.providerExecutionId === undefined ||
            input.runtimeConversationBootstrap.providerExecutionId === null ? null : (
              <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                {input.runtimeConversationBootstrap.providerExecutionId}
              </p>
            )}
            {input.transcriptIsPending ? (
              <p className="mt-2 text-xs text-muted-foreground">Loading provider transcript...</p>
            ) : null}
          </div>
        )}
        {input.transcriptErrorMessage === null ? null : (
          <p className="mt-2 text-xs text-destructive">{input.transcriptErrorMessage}</p>
        )}
        <DesignerActionProposals
          errorMessage={input.actionProposalResponseErrorMessage}
          onSubmitResponse={input.onActionProposalResponseSubmit}
          pendingProposalId={input.actionProposalResponsePendingId}
          proposals={input.runtimeConversationTranscript?.actionProposals ?? []}
          successMessage={input.actionProposalResponseSuccessMessage}
        />
        <div className="mt-3">
          <ChatComposer
            canUploadAttachments={false}
            composerCapabilities={[]}
            composerDraft={createComposerDraft(input.followUpDraft)}
            configControlsDisabled
            contextUsage={null}
            gitBranchLabel={null}
            isSubmitPending={input.followUpIsPending}
            isUploadingAttachments={false}
            modelOptions={[]}
            onClearPendingDiffComments={ignoreDesignerComposerAction}
            onComposerDraftChange={(draft) => {
              input.onFollowUpDraftChange(draft.text);
            }}
            onModelChange={ignoreDesignerComposerAction}
            onPendingFilesAdded={ignoreDesignerComposerAction}
            onReasoningEffortChange={ignoreDesignerComposerAction}
            onRemovePendingAttachment={ignoreDesignerComposerAction}
            onRuntimeCommandSubmit={ignoreDesignerComposerAction}
            onSubmit={input.onFollowUpSubmit}
            pendingAttachments={[]}
            pendingDiffCommentSummary={null}
            placeholderText="Ask Designer to continue refining this setup."
            pullRequest={null}
            reasoningEffortOptions={[]}
            selectedModel={null}
            selectedReasoningEffort={null}
            showAttachmentControl={false}
            showConfigControls={false}
            showReasoningControl={false}
            submitDisabled={!canSubmitFollowUp}
            submitDisabledReason={
              input.runtimeConversationBootstrap === null
                ? "Runtime conversation must be ready before follow-up submission."
                : "Write a follow-up first."
            }
            submitLabel={input.followUpIsPending ? "Submitting follow-up" : "Submit follow-up"}
            submitMode="start"
          />
          <ErrorNotice message={input.followUpErrorMessage} />
          {input.followUpSuccessMessage === null ? null : (
            <p className="mt-2 text-xs text-muted-foreground">{input.followUpSuccessMessage}</p>
          )}
        </div>
      </div>
    </section>
  );
}

function ignoreDesignerComposerAction(): void {}
function ignoreDesignerServerRequest(): void {}

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
      {input.proposals.map((proposal) => (
        <article className="rounded-lg border bg-muted/20 p-3" key={proposal.id}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium text-sm">{proposal.title}</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{proposal.summary}</p>
            </div>
            <Badge variant="secondary">{formatDesignerActionProposalStatus(proposal.status)}</Badge>
          </div>
          <dl className="mt-3 grid gap-2 text-xs">
            <div>
              <dt className="text-muted-foreground">Operation</dt>
              <dd className="mt-0.5">
                {proposal.operation.provider} {proposal.operation.action}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Resource</dt>
              <dd className="mt-0.5">
                {proposal.operation.resourceType}
                {proposal.operation.resourceLabel === null
                  ? ""
                  : `: ${proposal.operation.resourceLabel}`}
              </dd>
            </div>
            {proposal.operation.details.map((detail, detailIndex) => (
              <div key={`${proposal.id}:${String(detailIndex)}:${detail.label}`}>
                <dt className="text-muted-foreground">{detail.label}</dt>
                <dd className="mt-0.5 whitespace-pre-wrap">{detail.value}</dd>
              </div>
            ))}
          </dl>
          {proposal.status === "pending" ? (
            <div className="mt-3 flex flex-wrap gap-2">
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
            </div>
          ) : null}
        </article>
      ))}
      <ErrorNotice message={input.errorMessage} />
      {input.successMessage === null ? null : (
        <p className="text-xs text-muted-foreground">{input.successMessage}</p>
      )}
    </div>
  );
}

function formatDesignerActionProposalStatus(status: DesignerActionProposal["status"]): string {
  if (status === "pending") {
    return "Review required";
  }

  if (status === "approved") {
    return "Approved";
  }

  return "Declined";
}

function resolveRuntimeConversationPromptState(input: {
  bootstrapErrorMessage: string | null;
  bootstrapIsPending: boolean;
  runtimeConversationBootstrap: DesignerRuntimeConversationBootstrap | null;
  session: DesignerSession | null;
}): {
  label: string;
  detail: string;
} {
  if (input.runtimeConversationBootstrap !== null) {
    return {
      label: "Initial prompt submitted",
      detail: `Submitted at ${input.runtimeConversationBootstrap.initialPromptSubmittedAt}.`,
    };
  }

  if (input.bootstrapErrorMessage !== null) {
    return {
      label: "Initial prompt status unknown",
      detail: "Runtime bootstrap failed while submitting the prompt.",
    };
  }

  if (input.bootstrapIsPending) {
    return {
      label: "Initial prompt submitting",
      detail: "Submitting to the Designer runtime.",
    };
  }

  if (input.session === null) {
    return {
      label: "Initial prompt",
      detail: "Waiting to submit to the Designer runtime.",
    };
  }

  if (input.session.status === null || input.session.status === SandboxInstanceStatuses.FAILED) {
    return {
      label: "Initial prompt not submitted",
      detail: input.session.failureMessage ?? "Designer runtime is unavailable.",
    };
  }

  if (!input.session.connectable && !StartingDesignerSessionStatuses.has(input.session.status)) {
    return {
      label: "Initial prompt not submitted",
      detail: "Designer runtime is not connectable.",
    };
  }

  return {
    label: "Initial prompt",
    detail: "Waiting to submit to the Designer runtime.",
  };
}

export function DesignerSessionPageView(input: DesignerSessionPageViewProps): React.JSX.Element {
  return (
    <div className="grid min-h-svh grid-cols-[minmax(20rem,28rem)_1fr] bg-background">
      <aside className="flex min-h-0 flex-col border-r">
        <div className="border-b p-4">
          <div className="flex items-center justify-between gap-3">
            <h1 className="truncate text-base font-medium">Designer</h1>
            {input.session?.status === undefined ? null : (
              <Badge variant="secondary">{input.session.status ?? "unavailable"}</Badge>
            )}
          </div>
          <p className="mt-1 truncate text-sm text-muted-foreground">{input.sessionId}</p>
        </div>
        <div className="min-h-0 flex-1 p-4">
          <ErrorNotice message={input.errorMessage} />
          <div className="grid content-start gap-3">
            <RuntimeBootstrapState
              bootstrapErrorMessage={input.bootstrapErrorMessage}
              bootstrapIsPending={input.bootstrapIsPending}
              runtimeConversationBootstrap={input.runtimeConversationBootstrap}
              session={input.session}
            />
            <RuntimeConversationPreview
              actionProposalResponseErrorMessage={input.actionProposalResponseErrorMessage}
              actionProposalResponsePendingId={input.actionProposalResponsePendingId}
              actionProposalResponseSuccessMessage={input.actionProposalResponseSuccessMessage}
              bootstrapErrorMessage={input.bootstrapErrorMessage}
              bootstrapIsPending={input.bootstrapIsPending}
              followUpDraft={input.followUpDraft}
              followUpErrorMessage={input.followUpErrorMessage}
              followUpIsPending={input.followUpIsPending}
              followUpSuccessMessage={input.followUpSuccessMessage}
              onActionProposalResponseSubmit={input.onActionProposalResponseSubmit}
              onFollowUpDraftChange={input.onFollowUpDraftChange}
              onFollowUpSubmit={input.onFollowUpSubmit}
              runtimeConversationBootstrap={input.runtimeConversationBootstrap}
              runtimeConversationTranscript={input.runtimeConversationTranscript}
              session={input.session}
              transcriptErrorMessage={input.transcriptErrorMessage}
              transcriptIsPending={input.transcriptIsPending}
            />
          </div>
        </div>
      </aside>
      <main className="flex min-w-0 flex-col">
        <div className="flex min-h-14 items-center gap-2 border-b px-4">
          {(input.session?.canvasTabs ?? []).length === 0 ? (
            <span className="text-sm text-muted-foreground">Canvas</span>
          ) : (
            input.session?.canvasTabs.map((tab) => (
              <span className="rounded-md bg-muted px-2 py-1 text-sm" key={tab.id}>
                {tab.title}
              </span>
            ))
          )}
        </div>
        <div className="min-h-0 flex-1 p-4">
          <div className="flex h-full items-center justify-center rounded-lg border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">
            Canvas
          </div>
        </div>
      </main>
    </div>
  );
}
