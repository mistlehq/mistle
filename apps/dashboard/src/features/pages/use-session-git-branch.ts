import type { CodexJsonRpcClient } from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import { ExecStreamClient, type ExecCommandRequest } from "@mistle/sandbox-session-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

import type { SessionWorkbenchTransportManager } from "./use-session-workbench-transport.js";

const GitBranchCommandTimeoutMs = 5_000;

type GitBranchSnapshot = {
  branchLabel: string | null;
  headWatchPath: string | null;
};

type SessionGitBranchState = {
  branchLabel: string | null;
};

type FsChangedNotification = {
  changedPaths: readonly string[];
  watchId: string;
};

class GitBranchCommandError extends Error {
  command: string;
  exitCode: number;
  stderr: string;

  constructor(input: { command: string; exitCode: number; stderr: string }) {
    super(`Git command failed: ${input.command}`);
    this.command = input.command;
    this.exitCode = input.exitCode;
    this.stderr = input.stderr;
  }
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

function isFsChangedNotification(value: unknown): value is {
  method: "fs/changed";
  params: FsChangedNotification;
} {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const method = Reflect.get(value, "method");
  const params = Reflect.get(value, "params");
  if (method !== "fs/changed" || typeof params !== "object" || params === null) {
    return false;
  }

  const watchId = Reflect.get(params, "watchId");
  const changedPaths = Reflect.get(params, "changedPaths");
  return (
    typeof watchId === "string" &&
    Array.isArray(changedPaths) &&
    changedPaths.every((path) => typeof path === "string")
  );
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

    throw new GitBranchCommandError({
      command: ["git", ...input.args].join(" "),
      exitCode: result.exitCode,
      stderr: result.stderr,
    });
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
      headWatchPath: null,
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
    headWatchPath: `${gitDirectory}/HEAD`,
  };
}

export function useSessionGitBranch(input: {
  connectedAtIso: string | null;
  cwd: string | null;
  enabled: boolean;
  ensureTransportConnected: SessionWorkbenchTransportManager["ensureTransportConnected"];
  rpcClient: CodexJsonRpcClient | null;
  sandboxInstanceId: string | null;
}): SessionGitBranchState {
  const queryClient = useQueryClient();
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
    enabled: input.enabled && input.sandboxInstanceId !== null && input.cwd !== null,
    refetchOnMount: "always",
    queryFn: async () => {
      const sandboxInstanceId = input.sandboxInstanceId;
      const cwd = input.cwd;

      if (sandboxInstanceId === null || cwd === null) {
        return {
          branchLabel: null,
          headWatchPath: null,
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
    const rpcClient = input.rpcClient;
    const headWatchPath = query.data?.headWatchPath ?? null;

    if (!input.enabled || rpcClient === null || headWatchPath === null) {
      return;
    }

    const watchId = crypto.randomUUID();
    const unsubscribeNotification = rpcClient.onNotification((notification) => {
      if (!isFsChangedNotification(notification)) {
        return;
      }

      if (
        notification.params.watchId !== watchId ||
        !notification.params.changedPaths.includes(headWatchPath)
      ) {
        return;
      }

      void queryClient.invalidateQueries({
        queryKey,
      });
    });

    // This effect synchronizes React with app-server filesystem watch notifications.
    void rpcClient.call("fs/watch", {
      watchId,
      path: headWatchPath,
    });

    return () => {
      unsubscribeNotification();
      void rpcClient
        .call("fs/unwatch", {
          watchId,
        })
        .catch(() => {
          // The session stream may already be closed during normal workbench teardown.
        });
    };
  }, [input.enabled, input.rpcClient, query.data?.headWatchPath, queryClient, queryKey]);

  return {
    branchLabel: input.enabled && !query.isError ? (query.data?.branchLabel ?? null) : null,
  };
}

export {
  GitBranchCommandError,
  GitBranchCommandTimeoutMs,
  isFsChangedNotification,
  isNotGitRepositoryResult,
};
export type { FsChangedNotification, GitBranchSnapshot, SessionGitBranchState };
