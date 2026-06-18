import type {
  AgentStreamClient,
  CodexJsonRpcClient,
} from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import {
  getSandboxDeliveryDisposition,
  SandboxDeliveryDispositions,
  SandboxInstanceStatuses,
} from "@mistle/sandbox-lifecycle";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router";

import { readHttpErrorStatus } from "../api/http-api-error.js";
import {
  bootstrapDesignerRuntimeConversation,
  createDesignerRuntimeConnectionToken,
  designerRuntimeConversationBootstrapQueryKey,
  designerRuntimeConversationTranscriptQueryKey,
  designerSessionsQueryKey,
  getDesignerRuntimeConversationTranscript,
  getDesignerSession,
  submitDesignerActionProposalResponse,
  submitDesignerUserInputRequestResponse,
  type DesignerActionProposalResponse,
  type DesignerRuntimeConversationTranscript,
  type DesignerSession,
} from "../designer/designer-service.js";
import { useCodexSessionState } from "../session-agents/codex/session-state/index.js";
import { applyPatchedSessionTitleToCache } from "../sessions/session-header-title-model.js";
import {
  patchSandboxInstanceTitle,
  type PatchSandboxInstanceTitleResult,
} from "../sessions/sessions-service.js";
import { DesignerSessionPageView } from "./designer-session-page-view.js";
import { useSessionWorkbenchTransport } from "./use-session-workbench-transport.js";

const DesignerSessionRuntimeBootstrapPollIntervalMs = 2_000;
const DesignerSessionRuntimeBootstrapMaxRetries = 5;
const DesignerSessionRuntimeTranscriptPollIntervalMs = 2_000;
const TerminalDesignerRuntimeTurnStatuses = new Set<string>([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

function useDesignerSessionId(): string {
  const params = useParams();
  const sessionId = params["sessionId"];
  if (sessionId === undefined) {
    throw new Error("Designer session route is missing sessionId.");
  }

  return sessionId;
}

function designerSessionRuntimeIsUnavailable(session: DesignerSession): boolean {
  return session.status === null || session.status === SandboxInstanceStatuses.FAILED;
}

function canBootstrapRuntimeConversation(session: DesignerSession | null): boolean {
  if (
    session === null ||
    session.initialPrompt === null ||
    designerSessionRuntimeIsUnavailable(session)
  ) {
    return false;
  }

  const status = session.status;
  if (status === null) {
    return false;
  }

  const disposition = getSandboxDeliveryDisposition(status);
  return (
    disposition === SandboxDeliveryDispositions.DELIVER ||
    disposition === SandboxDeliveryDispositions.RESUME
  );
}

function shouldPollDesignerSessionForRuntimeBootstrap(session: DesignerSession | null): boolean {
  if (
    session === null ||
    session.initialPrompt === null ||
    designerSessionRuntimeIsUnavailable(session)
  ) {
    return false;
  }

  const status = session.status;
  if (status === null) {
    return false;
  }

  return (
    getSandboxDeliveryDisposition(status) === SandboxDeliveryDispositions.WAIT ||
    status === SandboxInstanceStatuses.STOPPING
  );
}

export function shouldPollDesignerRuntimeTranscript(
  transcript: DesignerRuntimeConversationTranscript | null,
  expectedProviderExecutionId?: string | null,
): boolean {
  if (transcript === null) {
    return true;
  }
  if (transcript.turns.length === 0) {
    return true;
  }
  if (
    expectedProviderExecutionId !== undefined &&
    expectedProviderExecutionId !== null &&
    !transcript.turns.some((turn) => turn.id === expectedProviderExecutionId)
  ) {
    return true;
  }

  return transcript.turns.some(
    (turn) => turn.status === null || !TerminalDesignerRuntimeTurnStatuses.has(turn.status),
  );
}

async function invalidateDesignerSessionQuery(input: {
  queryClient: ReturnType<typeof useQueryClient>;
  sessionId: string;
}): Promise<void> {
  await input.queryClient.invalidateQueries({
    queryKey: [...designerSessionsQueryKey, input.sessionId],
  });
}

function applyPatchedDesignerSessionTitleToCache(
  queryClient: ReturnType<typeof useQueryClient>,
  input: {
    patchedTitle: PatchSandboxInstanceTitleResult;
    sessionId: string;
  },
): void {
  queryClient.setQueryData<DesignerSession>(
    [...designerSessionsQueryKey, input.sessionId],
    (currentSession) => {
      if (currentSession === undefined) {
        return undefined;
      }

      if (currentSession.sandboxInstanceId !== input.patchedTitle.id) {
        return currentSession;
      }

      return {
        ...currentSession,
        title: input.patchedTitle.title,
        updatedAt: input.patchedTitle.updatedAt,
      };
    },
  );

  queryClient.setQueryData<readonly DesignerSession[]>(designerSessionsQueryKey, (currentList) => {
    if (currentList === undefined) {
      return undefined;
    }

    return currentList.map((designerSession) => {
      if (designerSession.sandboxInstanceId !== input.patchedTitle.id) {
        return designerSession;
      }

      return {
        ...designerSession,
        title: input.patchedTitle.title,
        updatedAt: input.patchedTitle.updatedAt,
      };
    });
  });
}

async function bootstrapDesignerRuntimeConversationAndRefreshSession(input: {
  queryClient: ReturnType<typeof useQueryClient>;
  sessionId: string;
  signal: AbortSignal;
}): Promise<Awaited<ReturnType<typeof bootstrapDesignerRuntimeConversation>>> {
  const runtimeConversationBootstrap = await bootstrapDesignerRuntimeConversation({
    sessionId: input.sessionId,
    signal: input.signal,
  });
  await invalidateDesignerSessionQuery({
    queryClient: input.queryClient,
    sessionId: input.sessionId,
  });
  return runtimeConversationBootstrap;
}

export function DesignerSessionPage(): React.JSX.Element {
  const sessionId = useDesignerSessionId();

  return <DesignerSessionPageContent key={sessionId} sessionId={sessionId} />;
}

function DesignerSessionPageContent(input: { sessionId: string }): React.JSX.Element {
  const sessionId = input.sessionId;
  const queryClient = useQueryClient();
  const [followUpDraft, setFollowUpDraft] = useState("");
  const [
    latestRuntimeSubmissionProviderExecutionId,
    setLatestRuntimeSubmissionProviderExecutionId,
  ] = useState<string | null>(null);
  const sessionClientRef = useRef<AgentStreamClient | null>(null);
  const rpcClientRef = useRef<CodexJsonRpcClient | null>(null);
  const sessionEventUnsubscribersRef = useRef<(() => void)[]>([]);

  const designerSessionQuery = useQuery({
    queryKey: [...designerSessionsQueryKey, sessionId],
    queryFn: async ({ signal }) => getDesignerSession({ sessionId, signal }),
    refetchInterval: (query) =>
      shouldPollDesignerSessionForRuntimeBootstrap(query.state.data ?? null)
        ? DesignerSessionRuntimeBootstrapPollIntervalMs
        : false,
  });
  const session = designerSessionQuery.data ?? null;
  const mintDesignerConnectionToken = useCallback(
    async () =>
      await createDesignerRuntimeConnectionToken({
        sessionId,
      }),
    [sessionId],
  );
  const transportManager = useSessionWorkbenchTransport({
    mintConnectionToken: mintDesignerConnectionToken,
    sandboxInstanceId: session?.sandboxInstanceId ?? null,
  });
  const codexSessionState = useCodexSessionState({
    ensureTransportConnected: transportManager.ensureTransportConnected,
    sessionClientRef,
    rpcClientRef,
    sessionEventUnsubscribersRef,
  });
  const codexLifecycle = codexSessionState.lifecycle;
  const codexChat = codexSessionState.chat;
  const codexSessionMessage = codexSessionState.sessionMessage;
  const bootstrapIsEnabled = canBootstrapRuntimeConversation(session);
  const runtimeConversationBootstrapQuery = useQuery({
    queryKey: [...designerRuntimeConversationBootstrapQueryKey, sessionId],
    queryFn: async ({ signal }) =>
      bootstrapDesignerRuntimeConversationAndRefreshSession({
        queryClient,
        sessionId,
        signal,
      }).catch(async (error: unknown) => {
        await invalidateDesignerSessionQuery({
          queryClient,
          sessionId,
        });
        throw error;
      }),
    enabled: bootstrapIsEnabled,
    gcTime: Number.POSITIVE_INFINITY,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: (failureCount, error) =>
      readHttpErrorStatus(error) === 409 &&
      failureCount < DesignerSessionRuntimeBootstrapMaxRetries,
    retryDelay: DesignerSessionRuntimeBootstrapPollIntervalMs,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const runtimeConversationBootstrap = runtimeConversationBootstrapQuery.data ?? null;
  const codexSessionSnapshot = codexLifecycle.sessionSnapshot;
  const connectedDesignerThreadId = codexSessionSnapshot?.activeThreadId ?? null;

  useEffect(() => {
    if (session === null || runtimeConversationBootstrap === null) {
      return;
    }

    const providerConversationId = runtimeConversationBootstrap.providerConversationId;
    const sessionSnapshot = codexSessionSnapshot;
    if (
      sessionSnapshot !== null &&
      sessionSnapshot.sandboxInstanceId === session.sandboxInstanceId &&
      sessionSnapshot.activeThreadId === providerConversationId
    ) {
      return;
    }

    codexLifecycle.connectSession({
      sandboxInstanceId: session.sandboxInstanceId,
      targetThreadId: providerConversationId,
      providerThreadId: providerConversationId,
    });
  }, [codexLifecycle.connectSession, codexSessionSnapshot, runtimeConversationBootstrap, session]);

  useEffect(() => {
    if (
      runtimeConversationBootstrap === null ||
      connectedDesignerThreadId !== runtimeConversationBootstrap.providerConversationId
    ) {
      return;
    }

    void codexChat.hydrateChatFromThread();
  }, [codexChat.hydrateChatFromThread, connectedDesignerThreadId, runtimeConversationBootstrap]);
  const submitActionProposalResponseMutation = useMutation({
    mutationFn: async (input: {
      sessionId: string;
      proposalId: string;
      response: DesignerActionProposalResponse;
      idempotencyKey: string;
    }) =>
      submitDesignerActionProposalResponse({
        sessionId: input.sessionId,
        proposalId: input.proposalId,
        response: input.response,
        idempotencyKey: input.idempotencyKey,
      }),
    onSuccess: (submission, variables) => {
      if (variables.sessionId !== sessionId) {
        return;
      }

      setLatestRuntimeSubmissionProviderExecutionId(
        submission.actionProposalResponse.providerExecutionId,
      );
      void invalidateDesignerSessionQuery({
        queryClient,
        sessionId: variables.sessionId,
      });
      void queryClient.invalidateQueries({
        queryKey: [...designerRuntimeConversationTranscriptQueryKey, variables.sessionId],
      });
      void codexChat.hydrateChatFromThread();
    },
  });
  const submitUserInputRequestResponseMutation = useMutation({
    mutationFn: async (input: { sessionId: string; requestId: string | number; result: unknown }) =>
      submitDesignerUserInputRequestResponse({
        sessionId: input.sessionId,
        requestId: input.requestId,
        result: input.result,
      }),
    onSuccess: (_submission, variables) => {
      if (variables.sessionId !== sessionId) {
        return;
      }

      void invalidateDesignerSessionQuery({
        queryClient,
        sessionId: variables.sessionId,
      });
      void queryClient.invalidateQueries({
        queryKey: [...designerRuntimeConversationTranscriptQueryKey, variables.sessionId],
      });
      void codexChat.hydrateChatFromThread();
    },
  });
  const patchTitleMutation = useMutation({
    mutationFn: async (input: { sandboxInstanceId: string; title: string }) =>
      patchSandboxInstanceTitle({
        instanceId: input.sandboxInstanceId,
        title: input.title,
      }),
    onSuccess: (patchedTitle, variables) => {
      if (session === null || variables.sandboxInstanceId !== session.sandboxInstanceId) {
        return;
      }

      applyPatchedSessionTitleToCache(queryClient, patchedTitle);
      applyPatchedDesignerSessionTitleToCache(queryClient, {
        patchedTitle,
        sessionId,
      });
    },
  });
  const runtimeConversationTranscriptQuery = useQuery({
    queryKey: [...designerRuntimeConversationTranscriptQueryKey, sessionId],
    queryFn: async ({ signal }) =>
      getDesignerRuntimeConversationTranscript({
        sessionId,
        signal,
      }),
    enabled: runtimeConversationBootstrapQuery.data !== undefined,
    refetchInterval: (query) =>
      shouldPollDesignerRuntimeTranscript(
        query.state.data ?? null,
        latestRuntimeSubmissionProviderExecutionId,
      )
        ? DesignerSessionRuntimeTranscriptPollIntervalMs
        : false,
  });
  const trimmedFollowUpDraft = followUpDraft.trim();
  const pendingActionProposalResponseId =
    submitActionProposalResponseMutation.isPending &&
    submitActionProposalResponseMutation.variables !== undefined
      ? submitActionProposalResponseMutation.variables.proposalId
      : null;
  const pendingUserInputRequestResponseId =
    submitUserInputRequestResponseMutation.isPending &&
    submitUserInputRequestResponseMutation.variables !== undefined
      ? submitUserInputRequestResponseMutation.variables.requestId
      : null;

  return (
    <DesignerSessionPageView
      bootstrapErrorMessage={runtimeConversationBootstrapQuery.error?.message ?? null}
      bootstrapIsPending={
        bootstrapIsEnabled &&
        (runtimeConversationBootstrapQuery.isPending ||
          runtimeConversationBootstrapQuery.isFetching)
      }
      chatState={codexChat.chatState}
      runtimeConversationBootstrap={runtimeConversationBootstrap}
      runtimeConversationTranscript={runtimeConversationTranscriptQuery.data ?? null}
      transcriptErrorMessage={runtimeConversationTranscriptQuery.error?.message ?? null}
      transcriptIsPending={
        runtimeConversationBootstrapQuery.data !== undefined &&
        (runtimeConversationTranscriptQuery.isPending ||
          runtimeConversationTranscriptQuery.isFetching)
      }
      followUpDraft={followUpDraft}
      followUpErrorMessage={codexSessionMessage.sessionErrorMessage}
      followUpIsPending={
        codexChat.isStartingTurn ||
        codexChat.isSteeringTurn ||
        codexChat.chatState.status === "inProgress"
      }
      followUpSuccessMessage={null}
      actionProposalResponseErrorMessage={
        submitActionProposalResponseMutation.error?.message ?? null
      }
      actionProposalResponsePendingId={pendingActionProposalResponseId}
      submittedActionProposalResponseId={
        submitActionProposalResponseMutation.data?.actionProposalResponse.proposalId ?? null
      }
      errorMessage={designerSessionQuery.error?.message ?? null}
      onFollowUpDraftChange={(draft) => {
        setFollowUpDraft(draft);
        codexSessionMessage.clearSessionErrorMessage();
      }}
      onFollowUpSubmit={() => {
        if (runtimeConversationBootstrap === null || trimmedFollowUpDraft.length === 0) {
          return;
        }

        if (!submitActionProposalResponseMutation.isPending) {
          submitActionProposalResponseMutation.reset();
        }
        void codexChat
          .startTurn({
            submittedPrompt: trimmedFollowUpDraft,
            resolveSkillMentions: false,
          })
          .then(() => {
            setFollowUpDraft("");
            void queryClient.invalidateQueries({
              queryKey: [...designerRuntimeConversationTranscriptQueryKey, sessionId],
            });
          })
          .catch((error: unknown) => {
            codexSessionMessage.reportSessionErrorMessage(
              error instanceof Error ? error.message : "Could not submit Designer follow-up.",
            );
          });
      }}
      onActionProposalResponseSubmit={(proposalId, response) => {
        if (
          runtimeConversationBootstrapQuery.data === undefined ||
          submitActionProposalResponseMutation.isPending
        ) {
          return;
        }

        submitActionProposalResponseMutation.mutate({
          sessionId,
          proposalId,
          response,
          idempotencyKey: crypto.randomUUID(),
        });
      }}
      onTitleSave={async (title) => {
        if (session === null) {
          return;
        }

        await patchTitleMutation.mutateAsync({
          sandboxInstanceId: session.sandboxInstanceId,
          title,
        });
      }}
      onUserInputRequestResponseSubmit={(requestId, result) => {
        if (
          runtimeConversationBootstrapQuery.data === undefined ||
          submitUserInputRequestResponseMutation.isPending
        ) {
          return;
        }

        if (!submitActionProposalResponseMutation.isPending) {
          submitActionProposalResponseMutation.reset();
        }
        submitUserInputRequestResponseMutation.mutate({
          sessionId,
          requestId,
          result,
        });
      }}
      userInputRequestResponseErrorMessage={
        submitUserInputRequestResponseMutation.error?.message ?? null
      }
      userInputRequestResponseIsPending={submitUserInputRequestResponseMutation.isPending}
      userInputRequestResponsePendingId={pendingUserInputRequestResponseId}
      session={session}
      sessionId={sessionId}
    />
  );
}
