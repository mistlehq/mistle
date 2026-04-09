import { ExecStreamClient, type ExecCommandResult } from "@mistle/sandbox-session-client";
import { useQuery } from "@tanstack/react-query";

import type { SessionWorkbenchTransportManager } from "./use-session-workbench-transport.js";

const BranchDiffCommandTimeoutMs = 15_000;
const BranchDiffMaxOutputBytes = 256 * 1024;

type SessionBranchDiffState = {
  errorMessage: string | null;
  isLoading: boolean;
  patch: string;
  truncatedMessage: string | null;
};

async function runGitCommand(input: {
  args: string[];
  ensureTransportConnected: SessionWorkbenchTransportManager["ensureTransportConnected"];
  sandboxInstanceId: string;
}): Promise<ExecCommandResult> {
  const { transport } = await input.ensureTransportConnected({
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const exec = new ExecStreamClient({
    transport,
  });

  return await exec.run({
    command: "git",
    args: input.args,
    maxOutputBytes: BranchDiffMaxOutputBytes,
    timeoutMs: BranchDiffCommandTimeoutMs,
  });
}

function formatGitFailureDetails(result: ExecCommandResult): string {
  const details = [result.stderr.trim(), result.stdout.trim()].find((value) => value.length > 0);
  if (details === undefined) {
    return "Git returned an error.";
  }

  return details;
}

async function loadBranchDiff(input: {
  ensureTransportConnected: SessionWorkbenchTransportManager["ensureTransportConnected"];
  sandboxInstanceId: string;
}): Promise<{ patch: string; truncatedMessage: string | null }> {
  const repoCheck = await runGitCommand({
    args: ["rev-parse", "--is-inside-work-tree"],
    ensureTransportConnected: input.ensureTransportConnected,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  if (repoCheck.exitCode !== 0 || repoCheck.stdout.trim() !== "true") {
    throw new Error("Current workspace is not a git repository.");
  }

  const baseCheck = await runGitCommand({
    args: ["rev-parse", "--verify", "main"],
    ensureTransportConnected: input.ensureTransportConnected,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  if (baseCheck.exitCode !== 0) {
    throw new Error("Local branch `main` does not exist.");
  }

  const diffResult = await runGitCommand({
    args: ["diff", "--merge-base", "main", "HEAD"],
    ensureTransportConnected: input.ensureTransportConnected,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  if (diffResult.exitCode !== 0) {
    throw new Error(formatGitFailureDetails(diffResult));
  }

  return {
    patch: diffResult.stdout,
    truncatedMessage: diffResult.truncated
      ? `Diff output was truncated to ${String(BranchDiffMaxOutputBytes)} bytes.`
      : null,
  };
}

function normalizeBranchDiffError(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Could not load changes compared with main.";
  }

  if (error.message.includes("command timed out")) {
    return "Timed out loading changes compared with main.";
  }

  return error.message;
}

export function useSessionBranchDiff(input: {
  enabled: boolean;
  ensureTransportConnected: SessionWorkbenchTransportManager["ensureTransportConnected"];
  sandboxInstanceId: string | null;
}): SessionBranchDiffState {
  const query = useQuery({
    enabled: input.enabled && input.sandboxInstanceId !== null,
    queryFn: async () => {
      const sandboxInstanceId = input.sandboxInstanceId;
      if (sandboxInstanceId === null) {
        throw new Error("Session id is required.");
      }

      return await loadBranchDiff({
        ensureTransportConnected: input.ensureTransportConnected,
        sandboxInstanceId,
      });
    },
    queryKey: ["session-branch-diff", input.sandboxInstanceId],
    retry: false,
  });

  return {
    errorMessage: query.isError ? normalizeBranchDiffError(query.error) : null,
    isLoading: query.isLoading,
    patch: query.data?.patch ?? "",
    truncatedMessage: query.data?.truncatedMessage ?? null,
  };
}

export { BranchDiffCommandTimeoutMs, BranchDiffMaxOutputBytes, normalizeBranchDiffError };
