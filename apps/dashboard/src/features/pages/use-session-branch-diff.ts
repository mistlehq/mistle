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

type BranchDiffLoadResult = {
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

async function readMergeBase(input: {
  ensureTransportConnected: SessionWorkbenchTransportManager["ensureTransportConnected"];
  sandboxInstanceId: string;
}): Promise<string> {
  const mergeBaseResult = await runGitCommand({
    args: ["merge-base", "main", "HEAD"],
    ensureTransportConnected: input.ensureTransportConnected,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  if (mergeBaseResult.exitCode !== 0) {
    throw new Error(formatGitFailureDetails(mergeBaseResult));
  }

  const mergeBase = mergeBaseResult.stdout.trim();
  if (mergeBase.length === 0) {
    throw new Error("Could not resolve the merge-base with `main`.");
  }

  return mergeBase;
}

async function readTrackedWorktreeDiff(input: {
  ensureTransportConnected: SessionWorkbenchTransportManager["ensureTransportConnected"];
  mergeBase: string;
  sandboxInstanceId: string;
}): Promise<ExecCommandResult> {
  const diffResult = await runGitCommand({
    args: ["diff", "--binary", input.mergeBase],
    ensureTransportConnected: input.ensureTransportConnected,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  if (diffResult.exitCode !== 0) {
    throw new Error(formatGitFailureDetails(diffResult));
  }

  return diffResult;
}

async function listUntrackedFiles(input: {
  ensureTransportConnected: SessionWorkbenchTransportManager["ensureTransportConnected"];
  sandboxInstanceId: string;
}): Promise<string[]> {
  const result = await runGitCommand({
    args: ["ls-files", "--others", "--exclude-standard"],
    ensureTransportConnected: input.ensureTransportConnected,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  if (result.exitCode !== 0) {
    throw new Error(formatGitFailureDetails(result));
  }

  return result.stdout
    .split("\n")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

async function readUntrackedFilePatch(input: {
  ensureTransportConnected: SessionWorkbenchTransportManager["ensureTransportConnected"];
  path: string;
  sandboxInstanceId: string;
}): Promise<ExecCommandResult> {
  const result = await runGitCommand({
    args: ["diff", "--binary", "--no-index", "--", "/dev/null", input.path],
    ensureTransportConnected: input.ensureTransportConnected,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw new Error(formatGitFailureDetails(result));
  }

  return result;
}

async function loadBranchDiff(input: {
  ensureTransportConnected: SessionWorkbenchTransportManager["ensureTransportConnected"];
  sandboxInstanceId: string;
}): Promise<BranchDiffLoadResult> {
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

  const mergeBase = await readMergeBase({
    ensureTransportConnected: input.ensureTransportConnected,
    sandboxInstanceId: input.sandboxInstanceId,
  });

  const trackedDiffResult = await readTrackedWorktreeDiff({
    ensureTransportConnected: input.ensureTransportConnected,
    mergeBase,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const untrackedFiles = await listUntrackedFiles({
    ensureTransportConnected: input.ensureTransportConnected,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const untrackedDiffResults: ExecCommandResult[] = [];
  for (const path of untrackedFiles) {
    untrackedDiffResults.push(
      await readUntrackedFilePatch({
        ensureTransportConnected: input.ensureTransportConnected,
        path,
        sandboxInstanceId: input.sandboxInstanceId,
      }),
    );
  }

  const patch = [trackedDiffResult.stdout, ...untrackedDiffResults.map((result) => result.stdout)]
    .filter((value) => value.length > 0)
    .join("");
  const wasTruncated =
    trackedDiffResult.truncated || untrackedDiffResults.some((result) => result.truncated);
  if (patch.length === 0) {
    return {
      patch,
      truncatedMessage: null,
    };
  }

  return {
    patch,
    truncatedMessage: wasTruncated
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
