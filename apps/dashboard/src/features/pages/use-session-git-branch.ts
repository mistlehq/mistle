import type { CodexJsonRpcClient } from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import { ExecStreamClient, type ExecCommandRequest } from "@mistle/sandbox-session-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

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

async function runGitCommand(input: {
  args: string[];
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
    return null;
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
  const queryKey = getSessionGitBranchQueryKey({
    connectedAtIso: input.connectedAtIso,
    sandboxInstanceId: input.sandboxInstanceId,
    cwd: input.cwd,
  });
  const query = useQuery({
    enabled: input.enabled && input.sandboxInstanceId !== null && input.cwd !== null,
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
    retry: false,
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
      void rpcClient.call("fs/unwatch", {
        watchId,
      });
    };
  }, [input.enabled, input.rpcClient, query.data?.headWatchPath, queryClient, queryKey]);

  return {
    branchLabel: query.data?.branchLabel ?? null,
  };
}

export { GitBranchCommandTimeoutMs, isFsChangedNotification };
export type { FsChangedNotification, GitBranchSnapshot, SessionGitBranchState };
