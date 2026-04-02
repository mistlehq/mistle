import { type QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { SandboxProfilesApiError } from "../sandbox-profiles/sandbox-profiles-api-errors.js";
import { getSandboxInstanceStatus, resumeSandboxInstance } from "../sessions/sessions-service.js";
import {
  type SandboxLifecycleStatus,
  shouldShowResumeInFlightState,
} from "./session-workbench-state.js";

type ResumeRequestGuard = {
  requestId: number;
  sandboxInstanceId: string;
};

function resolveResumeFailureMessage(error: unknown): string {
  if (error instanceof SandboxProfilesApiError) {
    return error.message;
  }

  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return "Could not resume sandbox session.";
}

export function isActiveResumeRequest(input: {
  activeRequest: ResumeRequestGuard | null;
  requestId: number;
  sandboxInstanceId: string;
}): boolean {
  return (
    input.activeRequest !== null &&
    input.activeRequest.requestId === input.requestId &&
    input.activeRequest.sandboxInstanceId === input.sandboxInstanceId
  );
}

export function seedSandboxInstanceStatusQuery(input: {
  queryClient: QueryClient;
  sandboxInstanceId: string;
  sandboxStatus: Awaited<ReturnType<typeof getSandboxInstanceStatus>>;
}): void {
  input.queryClient.setQueryData(
    ["sandbox-instance-status", input.sandboxInstanceId] as const,
    input.sandboxStatus,
  );
}

export function useSessionWorkbenchStoppedResume(input: {
  clearLifecycleErrorMessage: () => void;
  hasRecoverableDisconnect: boolean;
  onResumeSucceeded: () => void;
  queryClient: QueryClient;
  refetchSandboxStatus: () => Promise<unknown>;
  sandboxInstanceId: string | null;
  trustedSandboxStatus: SandboxLifecycleStatus | null;
}) {
  const [hasAttemptedInitialStoppedResume, setHasAttemptedInitialStoppedResume] = useState(false);
  const [isResumingStoppedSandbox, setIsResumingStoppedSandbox] = useState(false);
  const [resumeActionErrorMessage, setResumeActionErrorMessage] = useState<string | null>(null);
  const activeResumeRequestRef = useRef<ResumeRequestGuard | null>(null);
  const resumeIdempotencyKeyRef = useRef<string | null>(null);
  const nextResumeRequestIdRef = useRef(0);

  useEffect(() => {
    setHasAttemptedInitialStoppedResume(false);
    setIsResumingStoppedSandbox(false);
    setResumeActionErrorMessage(null);
    activeResumeRequestRef.current = null;
    resumeIdempotencyKeyRef.current = null;
    nextResumeRequestIdRef.current = 0;
  }, [input.sandboxInstanceId]);

  const shouldAttemptRecoverableStoppedResume =
    input.sandboxInstanceId !== null &&
    input.trustedSandboxStatus === "stopped" &&
    input.hasRecoverableDisconnect;
  const shouldAttemptInitialStoppedResume =
    input.sandboxInstanceId !== null &&
    input.trustedSandboxStatus === "stopped" &&
    !input.hasRecoverableDisconnect &&
    !hasAttemptedInitialStoppedResume;
  const isShowingResumeInFlightState = shouldShowResumeInFlightState({
    hasAttemptedInitialStoppedResume,
    resumeActionErrorMessage,
    shouldAttemptInitialStoppedResume:
      shouldAttemptInitialStoppedResume || shouldAttemptRecoverableStoppedResume,
    isResumingStoppedSandbox,
    sandboxStatus: input.trustedSandboxStatus,
  });

  const requestStoppedSandboxResume = useCallback(async (): Promise<void> => {
    if (
      input.sandboxInstanceId === null ||
      input.trustedSandboxStatus !== "stopped" ||
      isResumingStoppedSandbox
    ) {
      return;
    }

    const idempotencyKey = resumeIdempotencyKeyRef.current ?? crypto.randomUUID();
    resumeIdempotencyKeyRef.current = idempotencyKey;
    const requestId = nextResumeRequestIdRef.current + 1;
    nextResumeRequestIdRef.current = requestId;
    activeResumeRequestRef.current = {
      requestId,
      sandboxInstanceId: input.sandboxInstanceId,
    };
    setHasAttemptedInitialStoppedResume(true);
    setResumeActionErrorMessage(null);

    input.clearLifecycleErrorMessage();
    setIsResumingStoppedSandbox(true);
    try {
      const resumedSandboxStatus = await resumeSandboxInstance({
        instanceId: input.sandboxInstanceId,
        idempotencyKey,
      });
      if (
        !isActiveResumeRequest({
          activeRequest: activeResumeRequestRef.current,
          requestId,
          sandboxInstanceId: input.sandboxInstanceId,
        })
      ) {
        return;
      }

      seedSandboxInstanceStatusQuery({
        queryClient: input.queryClient,
        sandboxInstanceId: input.sandboxInstanceId,
        sandboxStatus: resumedSandboxStatus,
      });
      if (resumedSandboxStatus.status !== "stopped") {
        resumeIdempotencyKeyRef.current = null;
      }

      input.clearLifecycleErrorMessage();
      input.onResumeSucceeded();
      void input.refetchSandboxStatus().catch(() => {});
    } catch (error) {
      if (
        !isActiveResumeRequest({
          activeRequest: activeResumeRequestRef.current,
          requestId,
          sandboxInstanceId: input.sandboxInstanceId,
        })
      ) {
        return;
      }

      if (error instanceof SandboxProfilesApiError && error.status < 500) {
        resumeIdempotencyKeyRef.current = null;
      }
      setResumeActionErrorMessage(resolveResumeFailureMessage(error));
    } finally {
      if (
        isActiveResumeRequest({
          activeRequest: activeResumeRequestRef.current,
          requestId,
          sandboxInstanceId: input.sandboxInstanceId,
        })
      ) {
        activeResumeRequestRef.current = null;
        setIsResumingStoppedSandbox(false);
      }
    }
  }, [
    input.clearLifecycleErrorMessage,
    input.onResumeSucceeded,
    input.queryClient,
    input.refetchSandboxStatus,
    input.sandboxInstanceId,
    input.trustedSandboxStatus,
    isResumingStoppedSandbox,
  ]);

  return {
    hasAttemptedInitialStoppedResume,
    isShowingResumeInFlightState,
    isResumingStoppedSandbox,
    requestStoppedSandboxResume,
    resumeActionErrorMessage,
    shouldAttemptInitialStoppedResume,
    shouldAttemptRecoverableStoppedResume,
  };
}
