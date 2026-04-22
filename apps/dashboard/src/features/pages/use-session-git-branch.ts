import { ExecStreamClient, type ExecCommandRequest } from "@mistle/sandbox-session-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";

import type { SessionWorkbenchTransportManager } from "./use-session-workbench-transport.js";

const GitBranchCommandTimeoutMs = 5_000;

type GitBranchSnapshot = {
  branchLabel: string | null;
};

type SessionGitBranchState = {
  branchLabel: string | null;
};

function shouldInvalidateForRefreshKey(input: {
  previousRefreshKey: string | null | undefined;
  refreshKey: string | null;
}): boolean {
  return (
    input.refreshKey !== null &&
    input.previousRefreshKey !== undefined &&
    input.previousRefreshKey !== input.refreshKey
  );
}

export function buildGitBranchExecRequest(input: {
  args: string[];
  cwd: string;
}): ExecCommandRequest {
  return {
    args: input.args,
    command: "git",
    cwd: input.cwd,
    timeoutMs: GitBranchCommandTimeoutMs,
  };
}

export function getSessionGitBranchQueryKey(input: {
  connectedAtIso: string | null;
  sandboxInstanceId: string | null;
  cwd: string | null;
}): readonly ["session-git-branch", string | null, string | null, string | null] {
  return ["session-git-branch", input.sandboxInstanceId, input.cwd, input.connectedAtIso];
}

function isNotGitRepositoryResult(input: { exitCode: number; stderr: string }): boolean {
  return (
    input.exitCode === 128 && /not a git repository|not in a git directory/i.test(input.stderr)
  );
}

async function runGitCommand(input: {
  args: string[];
  classifyNotGitRepositoryResult?: boolean;
  cwd: string;
  ensureTransportConnected: SessionWorkbenchTransportManager["ensureTransportConnected"];
  sandboxInstanceId: string;
}): Promise<string | null> {
  const { transport } = await input.ensureTransportConnected({
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const exec = new ExecStreamClient({
    transport,
  });
  const result = await exec.run(
    buildGitBranchExecRequest({
      args: input.args,
      cwd: input.cwd,
    }),
  );

  if (result.exitCode !== 0) {
    if (
      input.classifyNotGitRepositoryResult === true &&
      isNotGitRepositoryResult({
        exitCode: result.exitCode,
        stderr: result.stderr,
      })
    ) {
      return null;
    }

    throw new Error(`Git command failed: ${["git", ...input.args].join(" ")}`);
  }

  const output = result.stdout.trim();
  return output.length > 0 ? output : null;
}

async function loadSessionGitBranch(input: {
  cwd: string;
  ensureTransportConnected: SessionWorkbenchTransportManager["ensureTransportConnected"];
  sandboxInstanceId: string;
}): Promise<GitBranchSnapshot> {
  const gitDirectory = await runGitCommand({
    args: ["rev-parse", "--absolute-git-dir"],
    classifyNotGitRepositoryResult: true,
    cwd: input.cwd,
    ensureTransportConnected: input.ensureTransportConnected,
    sandboxInstanceId: input.sandboxInstanceId,
  });

  if (gitDirectory === null) {
    return {
      branchLabel: null,
    };
  }

  const branchLabel = await runGitCommand({
    args: ["branch", "--show-current"],
    cwd: input.cwd,
    ensureTransportConnected: input.ensureTransportConnected,
    sandboxInstanceId: input.sandboxInstanceId,
  });

  return {
    branchLabel,
  };
}

export function useSessionGitBranch(input: {
  connectedAtIso: string | null;
  cwd: string | null;
  enabled: boolean;
  ensureTransportConnected: SessionWorkbenchTransportManager["ensureTransportConnected"];
  refreshKey: string | null;
  sandboxInstanceId: string | null;
}): SessionGitBranchState {
  const queryClient = useQueryClient();
  const lastRefreshKeyRef = useRef<string | null | undefined>(undefined);
  const isBranchTrackingEnabled =
    input.enabled && input.sandboxInstanceId !== null && input.cwd !== null;
  const queryKey = useMemo(
    () =>
      getSessionGitBranchQueryKey({
        connectedAtIso: input.connectedAtIso,
        sandboxInstanceId: input.sandboxInstanceId,
        cwd: input.cwd,
      }),
    [input.connectedAtIso, input.cwd, input.sandboxInstanceId],
  );
  const query = useQuery({
    enabled: isBranchTrackingEnabled,
    refetchOnMount: "always",
    queryFn: async () => {
      const sandboxInstanceId = input.sandboxInstanceId;
      const cwd = input.cwd;

      if (sandboxInstanceId === null || cwd === null) {
        return {
          branchLabel: null,
        } satisfies GitBranchSnapshot;
      }

      return await loadSessionGitBranch({
        cwd,
        ensureTransportConnected: input.ensureTransportConnected,
        sandboxInstanceId,
      });
    },
    queryKey,
    retry: 2,
    retryDelay: 200,
    staleTime: Number.POSITIVE_INFINITY,
  });

  useEffect(() => {
    if (!isBranchTrackingEnabled) {
      lastRefreshKeyRef.current = input.refreshKey;
      return;
    }

    if (
      shouldInvalidateForRefreshKey({
        previousRefreshKey: lastRefreshKeyRef.current,
        refreshKey: input.refreshKey,
      })
    ) {
      void queryClient.invalidateQueries({
        queryKey,
      });
    }

    lastRefreshKeyRef.current = input.refreshKey;
  }, [input.refreshKey, isBranchTrackingEnabled, queryClient, queryKey]);

  const shouldHideBranchLabel =
    !isBranchTrackingEnabled || query.isError || (query.isFetching && !query.isFetchedAfterMount);

  return {
    branchLabel: shouldHideBranchLabel ? null : (query.data?.branchLabel ?? null),
  };
}

export { GitBranchCommandTimeoutMs, shouldInvalidateForRefreshKey };
