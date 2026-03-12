import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import {
  getSandboxInstanceStatus,
  startSandboxInstanceFromProfileVersion,
  type SandboxInstanceStatusResult,
} from "./sessions-service.js";

const SandboxStatusPollIntervalMs = 1_000;

export type LaunchedSandboxSession = {
  profileId: string;
  profileDisplayName: string;
  profileVersion: number;
  sandboxInstanceId: string;
  workflowRunId: string;
  createdAtIso: string;
  status: SandboxInstanceStatusResult["status"];
  failureCode: string | null;
  failureMessage: string | null;
};

export type UseSandboxSessionLaunchStateResult = {
  launchedSessions: readonly LaunchedSandboxSession[];
  startErrorMessage: string | null;
  isStartingSession: boolean;
  startSession: (input: {
    profileId: string;
    profileDisplayName: string;
    profileVersion: number;
  }) => void;
  clearStartErrorMessage: () => void;
};

function describeStepError(stepLabel: string, error: unknown): Error {
  if (error instanceof Error && error.message.trim().length > 0) {
    return new Error(`${stepLabel} failed: ${error.message}`);
  }

  return new Error(`${stepLabel} failed.`);
}

function applySessionStatus(
  session: LaunchedSandboxSession,
  status: SandboxInstanceStatusResult,
): LaunchedSandboxSession {
  return {
    ...session,
    status: status.status,
    failureCode: status.failureCode,
    failureMessage: status.failureMessage,
  };
}

export function useSandboxSessionLaunchState(): UseSandboxSessionLaunchStateResult {
  const [launchedSessions, setLaunchedSessions] = useState<readonly LaunchedSandboxSession[]>([]);
  const [startErrorMessage, setStartErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const sessionsPendingStatus = launchedSessions.filter(
      (session) => session.status === "starting",
    );
    if (sessionsPendingStatus.length === 0) {
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      void Promise.all(
        sessionsPendingStatus.map(async (session) => {
          const status = await getSandboxInstanceStatus({
            instanceId: session.sandboxInstanceId,
          });

          if (cancelled) {
            return;
          }

          setLaunchedSessions((current) =>
            current.map((currentSession) =>
              currentSession.sandboxInstanceId === session.sandboxInstanceId
                ? applySessionStatus(currentSession, status)
                : currentSession,
            ),
          );
        }),
      ).catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        setStartErrorMessage(
          error instanceof Error ? error.message : "Could not refresh sandbox session status.",
        );
      });
    }, SandboxStatusPollIntervalMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [launchedSessions]);

  const startSessionMutation = useMutation({
    mutationFn: async (input: {
      profileId: string;
      profileDisplayName: string;
      profileVersion: number;
    }) => {
      try {
        return await startSandboxInstanceFromProfileVersion({
          profileId: input.profileId,
          profileVersion: input.profileVersion,
          idempotencyKey: crypto.randomUUID(),
        });
      } catch (error) {
        throw describeStepError("Starting sandbox instance", error);
      }
    },
    onSuccess: (result, input) => {
      setLaunchedSessions((current) => [
        {
          profileId: input.profileId,
          profileDisplayName: input.profileDisplayName,
          profileVersion: input.profileVersion,
          sandboxInstanceId: result.sandboxInstanceId,
          workflowRunId: result.workflowRunId,
          createdAtIso: new Date().toISOString(),
          status: "starting",
          failureCode: null,
          failureMessage: null,
        },
        ...current.filter((session) => session.sandboxInstanceId !== result.sandboxInstanceId),
      ]);
      setStartErrorMessage(null);
    },
    onError: (error) => {
      setStartErrorMessage(
        error instanceof Error ? error.message : "Could not start sandbox session.",
      );
    },
  });

  return {
    launchedSessions,
    startErrorMessage,
    isStartingSession: startSessionMutation.isPending,
    startSession: (input) => {
      setStartErrorMessage(null);
      startSessionMutation.mutate(input);
    },
    clearStartErrorMessage: () => {
      setStartErrorMessage(null);
    },
  };
}
