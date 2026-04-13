import {
  ExecStreamClient,
  type ExecCommandRequest,
  type ExecCommandResult,
} from "@mistle/sandbox-session-client";
import { useQuery } from "@tanstack/react-query";

import type { SessionWorkbenchTransportManager } from "./use-session-workbench-transport.js";

const BranchDiffCommandTimeoutMs = 15_000;

type SessionBranchDiffState = {
  errorMessage: string | null;
  isLoading: boolean;
  patch: string;
};

type BranchDiffLoadResult = {
  patch: string;
};

export function buildBranchDiffGitExecRequest(input: {
  args: string[];
  cwd: string | null;
}): ExecCommandRequest {
  return {
    args: input.args,
    command: "git",
    ...(input.cwd === null ? {} : { cwd: input.cwd }),
    timeoutMs: BranchDiffCommandTimeoutMs,
  };
}

export function getSessionBranchDiffQueryKey(input: {
  sandboxInstanceId: string | null;
  cwd: string | null;
}): readonly ["session-branch-diff", string | null, string | null] {
  return ["session-branch-diff", input.sandboxInstanceId, input.cwd];
}

async function runGitCommand(input: {
  args: string[];
  cwd: string | null;
  ensureTransportConnected: SessionWorkbenchTransportManager["ensureTransportConnected"];
  sandboxInstanceId: string;
}): Promise<ExecCommandResult> {
  const { transport } = await input.ensureTransportConnected({
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const exec = new ExecStreamClient({
    transport,
  });

  return await exec.run(
    buildBranchDiffGitExecRequest({
      args: input.args,
      cwd: input.cwd,
    }),
  );
}

function formatGitFailureDetails(result: ExecCommandResult): string {
  const details = [result.stderr.trim(), result.stdout.trim()].find((value) => value.length > 0);
  if (details === undefined) {
    return "Git returned an error.";
  }

  return details;
}

async function readMergeBase(input: {
  cwd: string | null;
  ensureTransportConnected: SessionWorkbenchTransportManager["ensureTransportConnected"];
  sandboxInstanceId: string;
}): Promise<string> {
  const mergeBaseResult = await runGitCommand({
    args: ["merge-base", "main", "HEAD"],
    cwd: input.cwd,
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
  cwd: string | null;
  ensureTransportConnected: SessionWorkbenchTransportManager["ensureTransportConnected"];
  mergeBase: string;
  sandboxInstanceId: string;
}): Promise<ExecCommandResult> {
  const diffResult = await runGitCommand({
    args: ["diff", "--binary", input.mergeBase],
    cwd: input.cwd,
    ensureTransportConnected: input.ensureTransportConnected,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  if (diffResult.exitCode !== 0) {
    throw new Error(formatGitFailureDetails(diffResult));
  }

  return diffResult;
}

async function listUntrackedFiles(input: {
  cwd: string | null;
  ensureTransportConnected: SessionWorkbenchTransportManager["ensureTransportConnected"];
  sandboxInstanceId: string;
}): Promise<string[]> {
  const result = await runGitCommand({
    args: ["ls-files", "--others", "--exclude-standard", "-z"],
    cwd: input.cwd,
    ensureTransportConnected: input.ensureTransportConnected,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  if (result.exitCode !== 0) {
    throw new Error(formatGitFailureDetails(result));
  }

  const paths = result.stdout.split("\0");
  if (paths.at(-1) === "") {
    paths.pop();
  }
  return paths;
}

async function readUntrackedFilePatch(input: {
  cwd: string | null;
  ensureTransportConnected: SessionWorkbenchTransportManager["ensureTransportConnected"];
  path: string;
  sandboxInstanceId: string;
}): Promise<ExecCommandResult> {
  const result = await runGitCommand({
    args: ["diff", "--binary", "--no-index", "--", "/dev/null", input.path],
    cwd: input.cwd,
    ensureTransportConnected: input.ensureTransportConnected,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw new Error(formatGitFailureDetails(result));
  }

  return result;
}

async function loadBranchDiff(input: {
  cwd: string | null;
  ensureTransportConnected: SessionWorkbenchTransportManager["ensureTransportConnected"];
  sandboxInstanceId: string;
}): Promise<BranchDiffLoadResult> {
  const repoCheck = await runGitCommand({
    args: ["rev-parse", "--is-inside-work-tree"],
    cwd: input.cwd,
    ensureTransportConnected: input.ensureTransportConnected,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  if (repoCheck.exitCode !== 0 || repoCheck.stdout.trim() !== "true") {
    throw new Error("Current workspace is not a git repository.");
  }

  const baseCheck = await runGitCommand({
    args: ["rev-parse", "--verify", "main"],
    cwd: input.cwd,
    ensureTransportConnected: input.ensureTransportConnected,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  if (baseCheck.exitCode !== 0) {
    throw new Error("Local branch `main` does not exist.");
  }

  const mergeBase = await readMergeBase({
    cwd: input.cwd,
    ensureTransportConnected: input.ensureTransportConnected,
    sandboxInstanceId: input.sandboxInstanceId,
  });

  const trackedDiffResult = await readTrackedWorktreeDiff({
    cwd: input.cwd,
    ensureTransportConnected: input.ensureTransportConnected,
    mergeBase,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const untrackedFiles = await listUntrackedFiles({
    cwd: input.cwd,
    ensureTransportConnected: input.ensureTransportConnected,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const untrackedDiffResults: ExecCommandResult[] = [];
  for (const path of untrackedFiles) {
    untrackedDiffResults.push(
      await readUntrackedFilePatch({
        cwd: input.cwd,
        ensureTransportConnected: input.ensureTransportConnected,
        path,
        sandboxInstanceId: input.sandboxInstanceId,
      }),
    );
  }

  const patch = [trackedDiffResult.stdout, ...untrackedDiffResults.map((result) => result.stdout)]
    .filter((value) => value.length > 0)
    .join("");
  return { patch };
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
  cwd: string | null;
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
        cwd: input.cwd,
        ensureTransportConnected: input.ensureTransportConnected,
        sandboxInstanceId,
      });
    },
    queryKey: getSessionBranchDiffQueryKey({
      sandboxInstanceId: input.sandboxInstanceId,
      cwd: input.cwd,
    }),
    retry: false,
  });

  return {
    errorMessage: query.isError ? normalizeBranchDiffError(query.error) : null,
    isLoading: query.isLoading || query.isFetching,
    patch: query.data?.patch ?? "",
  };
}

export { BranchDiffCommandTimeoutMs, normalizeBranchDiffError };
