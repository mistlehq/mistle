import {
  getSandboxDeliveryDisposition,
  SandboxDeliveryDispositions,
  SandboxInstanceStatuses,
} from "@mistle/sandbox-lifecycle";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router";

import { readHttpErrorStatus } from "../api/http-api-error.js";
import {
  bootstrapDesignerRuntimeConversation,
  designerRuntimeConversationBootstrapQueryKey,
  designerRuntimeConversationTranscriptQueryKey,
  designerSessionsQueryKey,
  getDesignerRuntimeConversationTranscript,
  getDesignerSession,
  submitDesignerRuntimeFollowUp,
  type DesignerRuntimeConversationTranscript,
  type DesignerSession,
} from "../designer/designer-service.js";
import { DesignerSessionPageView } from "./designer-session-page-view.js";

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
  const [followUpSubmissionIdempotencyKey, setFollowUpSubmissionIdempotencyKey] = useState<
    string | null
  >(null);

  const designerSessionQuery = useQuery({
    queryKey: [...designerSessionsQueryKey, sessionId],
    queryFn: async ({ signal }) => getDesignerSession({ sessionId, signal }),
    refetchInterval: (query) =>
      shouldPollDesignerSessionForRuntimeBootstrap(query.state.data ?? null)
        ? DesignerSessionRuntimeBootstrapPollIntervalMs
        : false,
  });
  const session = designerSessionQuery.data ?? null;
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
  const submitFollowUpMutation = useMutation({
    mutationFn: async (input: { sessionId: string; prompt: string; idempotencyKey: string }) =>
      submitDesignerRuntimeFollowUp({
        sessionId: input.sessionId,
        prompt: input.prompt,
        idempotencyKey: input.idempotencyKey,
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
      setFollowUpDraft("");
      setFollowUpSubmissionIdempotencyKey(null);
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
        submitFollowUpMutation.data?.providerExecutionId ?? null,
      )
        ? DesignerSessionRuntimeTranscriptPollIntervalMs
        : false,
  });
  const trimmedFollowUpDraft = followUpDraft.trim();

  return (
    <DesignerSessionPageView
      bootstrapErrorMessage={runtimeConversationBootstrapQuery.error?.message ?? null}
      bootstrapIsPending={
        bootstrapIsEnabled &&
        (runtimeConversationBootstrapQuery.isPending ||
          runtimeConversationBootstrapQuery.isFetching)
      }
      runtimeConversationBootstrap={runtimeConversationBootstrapQuery.data ?? null}
      runtimeConversationTranscript={runtimeConversationTranscriptQuery.data ?? null}
      transcriptErrorMessage={runtimeConversationTranscriptQuery.error?.message ?? null}
      transcriptIsPending={
        runtimeConversationBootstrapQuery.data !== undefined &&
        (runtimeConversationTranscriptQuery.isPending ||
          runtimeConversationTranscriptQuery.isFetching)
      }
      followUpDraft={followUpDraft}
      followUpErrorMessage={submitFollowUpMutation.error?.message ?? null}
      followUpIsPending={submitFollowUpMutation.isPending}
      followUpSuccessMessage={
        submitFollowUpMutation.data === undefined
          ? null
          : `Follow-up submitted at ${submitFollowUpMutation.data.submittedAt}.`
      }
      errorMessage={designerSessionQuery.error?.message ?? null}
      onFollowUpDraftChange={(draft) => {
        setFollowUpDraft(draft);
        setFollowUpSubmissionIdempotencyKey(null);
        if (
          !submitFollowUpMutation.isPending &&
          (submitFollowUpMutation.data !== undefined || submitFollowUpMutation.error !== null)
        ) {
          submitFollowUpMutation.reset();
        }
      }}
      onFollowUpSubmit={() => {
        if (
          runtimeConversationBootstrapQuery.data === undefined ||
          trimmedFollowUpDraft.length === 0
        ) {
          return;
        }

        const idempotencyKey = followUpSubmissionIdempotencyKey ?? crypto.randomUUID();
        setFollowUpSubmissionIdempotencyKey(idempotencyKey);
        submitFollowUpMutation.mutate({
          sessionId,
          prompt: trimmedFollowUpDraft,
          idempotencyKey,
        });
      }}
      session={session}
      sessionId={sessionId}
    />
  );
}
