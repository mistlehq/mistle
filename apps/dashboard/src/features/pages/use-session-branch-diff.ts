import {
  ExecStreamClient,
  type ExecCommandRequest,
  type ExecCommandResult,
} from "@mistle/sandbox-session-client";
import { useQuery } from "@tanstack/react-query";

import type { SessionWorkbenchTransportManager } from "./use-session-workbench-transport.js";

const BranchDiffCommandTimeoutMs = 15_000;
const MissingDefaultBranchMessage =
  "Could not resolve the default branch from `origin/HEAD`. Configure the repository's origin default branch to load changes.";

type BranchDiffError = {
  kind: BranchDiffErrorKind;
  message: string;
};

type BranchDiffErrorKind =
  | "command_failed"
  | "missing_default_branch"
  | "missing_merge_base"
  | "missing_session_id"
  | "not_git_repository"
  | "timeout";

type BranchDiffErrorNotice = {
  message: string;
  title: string;
  variant: "alert" | "default";
};

type SessionBranchDiffState = {
  compareLabel: string;
  errorNotice: BranchDiffErrorNotice | null;
  isLoading: boolean;
  patch: string;
};

type BranchDiffLoadResult = {
  compareRef: string;
  patch: string;
};

function createBranchDiffError(input: BranchDiffError): BranchDiffError {
  return input;
}

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

function isBranchDiffErrorKind(kind: string): kind is BranchDiffErrorKind {
  switch (kind) {
    case "command_failed":
    case "missing_default_branch":
    case "missing_merge_base":
    case "missing_session_id":
    case "not_git_repository":
    case "timeout":
      return true;
  }

  return false;
}

function isBranchDiffError(error: unknown): error is BranchDiffError {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const maybeKind = "kind" in error ? error.kind : null;
  const maybeMessage = "message" in error ? error.message : null;

  return (
    typeof maybeKind === "string" &&
    isBranchDiffErrorKind(maybeKind) &&
    typeof maybeMessage === "string"
  );
}

function resolveBranchDiffErrorNotice(error: BranchDiffError): BranchDiffErrorNotice {
  switch (error.kind) {
    case "missing_default_branch":
    case "not_git_repository":
      return {
        message: error.message,
        title: "Changes unavailable",
        variant: "default",
      };
    case "command_failed":
    case "missing_merge_base":
    case "missing_session_id":
    case "timeout":
      return {
        message: error.message,
        title: "Could not load changes",
        variant: "alert",
      };
  }
}

function formatBranchDiffCompareLabel(compareRef: string | null): string {
  if (compareRef === null) {
    return "Compared with default branch";
  }

  return `Compared with ${compareRef}`;
}

function createMissingDefaultBranchError(): BranchDiffError {
  return createBranchDiffError({
    kind: "missing_default_branch",
    message: MissingDefaultBranchMessage,
  });
}

async function readDefaultBranchRef(input: {
  cwd: string | null;
  ensureTransportConnected: SessionWorkbenchTransportManager["ensureTransportConnected"];
  sandboxInstanceId: string;
}): Promise<string> {
  const result = await runGitCommand({
    args: ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
    cwd: input.cwd,
    ensureTransportConnected: input.ensureTransportConnected,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const defaultBranchRef = result.stdout.trim();
  if (result.exitCode !== 0 || defaultBranchRef.length === 0) {
    throw createMissingDefaultBranchError();
  }

  return defaultBranchRef;
}

async function readMergeBase(input: {
  compareRef: string;
  cwd: string | null;
  ensureTransportConnected: SessionWorkbenchTransportManager["ensureTransportConnected"];
  sandboxInstanceId: string;
}): Promise<string> {
  const mergeBaseResult = await runGitCommand({
    args: ["merge-base", input.compareRef, "HEAD"],
    cwd: input.cwd,
    ensureTransportConnected: input.ensureTransportConnected,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  if (mergeBaseResult.exitCode !== 0) {
    throw createBranchDiffError({
      kind: "command_failed",
      message: formatGitFailureDetails(mergeBaseResult),
    });
  }

  const mergeBase = mergeBaseResult.stdout.trim();
  if (mergeBase.length === 0) {
    throw createBranchDiffError({
      kind: "missing_merge_base",
      message: `Could not resolve the merge-base with \`${input.compareRef}\`.`,
    });
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
    throw createBranchDiffError({
      kind: "command_failed",
      message: formatGitFailureDetails(diffResult),
    });
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
    throw createBranchDiffError({
      kind: "command_failed",
      message: formatGitFailureDetails(result),
    });
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
    throw createBranchDiffError({
      kind: "command_failed",
      message: formatGitFailureDetails(result),
    });
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
    throw createBranchDiffError({
      kind: "not_git_repository",
      message: "Current workspace is not a git repository.",
    });
  }

  const compareRef = await readDefaultBranchRef({
    cwd: input.cwd,
    ensureTransportConnected: input.ensureTransportConnected,
    sandboxInstanceId: input.sandboxInstanceId,
  });

  const mergeBase = await readMergeBase({
    compareRef,
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
  return { compareRef, patch };
}

function normalizeBranchDiffError(error: unknown): BranchDiffErrorNotice {
  if (isBranchDiffError(error)) {
    return resolveBranchDiffErrorNotice(error);
  }

  if (error instanceof Error && error.message.includes("command timed out")) {
    return resolveBranchDiffErrorNotice(
      createBranchDiffError({
        kind: "timeout",
        message: "Timed out loading changes compared with the default branch.",
      }),
    );
  }

  if (error instanceof Error) {
    return resolveBranchDiffErrorNotice(
      createBranchDiffError({
        kind: "command_failed",
        message: error.message,
      }),
    );
  }

  return resolveBranchDiffErrorNotice(
    createBranchDiffError({
      kind: "command_failed",
      message: "Could not load changes compared with the default branch.",
    }),
  );
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
        throw createBranchDiffError({
          kind: "missing_session_id",
          message: "Session id is required.",
        });
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
    compareLabel: formatBranchDiffCompareLabel(query.data?.compareRef ?? null),
    errorNotice: query.isError ? normalizeBranchDiffError(query.error) : null,
    isLoading: query.isLoading || query.isFetching,
    patch: query.data?.patch ?? "",
  };
}

export {
  BranchDiffCommandTimeoutMs,
  formatBranchDiffCompareLabel,
  normalizeBranchDiffError,
  resolveBranchDiffErrorNotice,
};
