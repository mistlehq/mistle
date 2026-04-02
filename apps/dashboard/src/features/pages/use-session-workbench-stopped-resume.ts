import { type QueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";

import { SandboxProfilesApiError } from "../sandbox-profiles/sandbox-profiles-api-errors.js";
import { getSandboxInstanceStatus, resumeSandboxInstance } from "../sessions/sessions-service.js";
import { type SandboxLifecycleStatus } from "./session-workbench-state.js";

type ResumeRequestGuard = {
  requestId: number;
  sandboxInstanceId: string;
};

type StoppedResumeLocalState = {
  sandboxInstanceId: string | null;
  hasAttemptedInitialStoppedResume: boolean;
  isResumingStoppedSandbox: boolean;
  resumeActionErrorMessage: string | null;
};

type StoppedResumeRefs = {
  sandboxInstanceId: string | null;
  activeResumeRequest: ResumeRequestGuard | null;
  resumeIdempotencyKey: string | null;
  nextResumeRequestId: number;
};

function createStoppedResumeLocalState(sandboxInstanceId: string | null): StoppedResumeLocalState {
  return {
    sandboxInstanceId,
    hasAttemptedInitialStoppedResume: false,
    isResumingStoppedSandbox: false,
    resumeActionErrorMessage: null,
  };
}

function resolveStoppedResumeLocalState(
  state: StoppedResumeLocalState,
  sandboxInstanceId: string | null,
): StoppedResumeLocalState {
  return state.sandboxInstanceId === sandboxInstanceId
    ? state
    : createStoppedResumeLocalState(sandboxInstanceId);
}

function createStoppedResumeRefs(sandboxInstanceId: string | null): StoppedResumeRefs {
  return {
    sandboxInstanceId,
    activeResumeRequest: null,
    resumeIdempotencyKey: null,
    nextResumeRequestId: 0,
  };
}

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
  onResumeSucceeded: () => void;
  queryClient: QueryClient;
  refetchSandboxStatus: () => Promise<unknown>;
  sandboxInstanceId: string | null;
}) {
  const [rawLocalState, setRawLocalState] = useState(() =>
    createStoppedResumeLocalState(input.sandboxInstanceId),
  );
  const localState = resolveStoppedResumeLocalState(rawLocalState, input.sandboxInstanceId);
  const refs = useRef(createStoppedResumeRefs(input.sandboxInstanceId));
  if (refs.current.sandboxInstanceId !== input.sandboxInstanceId) {
    refs.current = createStoppedResumeRefs(input.sandboxInstanceId);
  }

  const updateLocalState = useCallback(
    (updater: (state: StoppedResumeLocalState) => StoppedResumeLocalState): void => {
      setRawLocalState((state) =>
        updater(resolveStoppedResumeLocalState(state, input.sandboxInstanceId)),
      );
    },
    [input.sandboxInstanceId],
  );

  const requestStoppedSandboxResume = useCallback(
    async (inputState: { trustedSandboxStatus: SandboxLifecycleStatus | null }): Promise<void> => {
      if (
        input.sandboxInstanceId === null ||
        inputState.trustedSandboxStatus !== "stopped" ||
        localState.isResumingStoppedSandbox
      ) {
        return;
      }

      const idempotencyKey = refs.current.resumeIdempotencyKey ?? crypto.randomUUID();
      refs.current.resumeIdempotencyKey = idempotencyKey;
      const requestId = refs.current.nextResumeRequestId + 1;
      refs.current.nextResumeRequestId = requestId;
      refs.current.activeResumeRequest = {
        requestId,
        sandboxInstanceId: input.sandboxInstanceId,
      };
      updateLocalState((state) => ({
        ...state,
        hasAttemptedInitialStoppedResume: true,
        resumeActionErrorMessage: null,
      }));

      input.clearLifecycleErrorMessage();
      updateLocalState((state) => ({
        ...state,
        isResumingStoppedSandbox: true,
      }));
      try {
        const resumedSandboxStatus = await resumeSandboxInstance({
          instanceId: input.sandboxInstanceId,
          idempotencyKey,
        });
        if (
          !isActiveResumeRequest({
            activeRequest: refs.current.activeResumeRequest,
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
          refs.current.resumeIdempotencyKey = null;
        }

        input.clearLifecycleErrorMessage();
        input.onResumeSucceeded();
        void input.refetchSandboxStatus().catch(() => {});
      } catch (error) {
        if (
          !isActiveResumeRequest({
            activeRequest: refs.current.activeResumeRequest,
            requestId,
            sandboxInstanceId: input.sandboxInstanceId,
          })
        ) {
          return;
        }

        if (error instanceof SandboxProfilesApiError && error.status < 500) {
          refs.current.resumeIdempotencyKey = null;
        }
        updateLocalState((state) => ({
          ...state,
          resumeActionErrorMessage: resolveResumeFailureMessage(error),
        }));
      } finally {
        if (
          isActiveResumeRequest({
            activeRequest: refs.current.activeResumeRequest,
            requestId,
            sandboxInstanceId: input.sandboxInstanceId,
          })
        ) {
          refs.current.activeResumeRequest = null;
          updateLocalState((state) => ({
            ...state,
            isResumingStoppedSandbox: false,
          }));
        }
      }
    },
    [
      input.clearLifecycleErrorMessage,
      input.onResumeSucceeded,
      input.queryClient,
      input.refetchSandboxStatus,
      input.sandboxInstanceId,
      localState.isResumingStoppedSandbox,
      updateLocalState,
    ],
  );

  return {
    hasAttemptedInitialStoppedResume: localState.hasAttemptedInitialStoppedResume,
    isResumingStoppedSandbox: localState.isResumingStoppedSandbox,
    requestStoppedSandboxResume,
    resumeActionErrorMessage: localState.resumeActionErrorMessage,
  };
}
