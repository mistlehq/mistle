import { ExecStreamClient, type ExecCommandRequest } from "@mistle/sandbox-session-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { NoLoadingIndicatorMeta } from "../shared/loading-indicator-meta.js";
import type { SessionWorkbenchTransportManager } from "./use-session-workbench-transport.js";

const RepositoryStatusCommandTimeoutMs = 5_000;
const SessionRepositoryStatusQueryKeyPrefix = "session-repository-status";

export type SessionPullRequestSummary = {
  isDraft: boolean;
  number: number;
  state: string;
  title: string;
  url: string;
};

export type SessionRepositoryStatus = {
  branchLabel: string | null;
  pullRequest: SessionPullRequestSummary | null;
};

const EmptyRepositoryStatus: SessionRepositoryStatus = {
  branchLabel: null,
  pullRequest: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function getSessionRepositoryStatusQueryKey(input: {
  connectedAtIso: string | null;
  sandboxInstanceId: string | null;
  cwd: string | null;
}) {
  return [
    SessionRepositoryStatusQueryKeyPrefix,
    input.sandboxInstanceId,
    input.cwd,
    input.connectedAtIso,
  ] as const;
}

function isNotGitRepositoryResult(input: { exitCode: number; stderr: string }): boolean {
  return (
    input.exitCode === 128 && /not a git repository|not in a git directory/i.test(input.stderr)
  );
}

function isCommandUnavailableResult(input: { exitCode: number; stderr: string }): boolean {
  return input.exitCode === 127 && /not found|command not found/i.test(input.stderr);
}

async function runRepositoryStatusCommand(input: {
  args: string[];
  classifyCommandUnavailableResult?: boolean;
  classifyNotGitRepositoryResult?: boolean;
  command: string;
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
  const result = await exec.run({
    args: input.args,
    command: input.command,
    cwd: input.cwd,
    timeoutMs: RepositoryStatusCommandTimeoutMs,
  } satisfies ExecCommandRequest);

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

    if (
      input.classifyCommandUnavailableResult === true &&
      isCommandUnavailableResult({
        exitCode: result.exitCode,
        stderr: result.stderr,
      })
    ) {
      return null;
    }

    throw new Error(
      `Command failed: ${[input.command, ...input.args].join(" ")}${
        result.stderr.length > 0 ? ` (${result.stderr.trim()})` : ""
      }`,
    );
  }

  const output = result.stdout.trim();
  return output.length > 0 ? output : null;
}

async function isGitHubCliAvailable(input: {
  cwd: string;
  ensureTransportConnected: SessionWorkbenchTransportManager["ensureTransportConnected"];
  sandboxInstanceId: string;
}): Promise<boolean> {
  const ghVersion = await runRepositoryStatusCommand({
    args: ["--version"],
    classifyCommandUnavailableResult: true,
    command: "gh",
    cwd: input.cwd,
    ensureTransportConnected: input.ensureTransportConnected,
    sandboxInstanceId: input.sandboxInstanceId,
  });

  return ghVersion !== null;
}

function parsePullRequestSummary(output: string): SessionPullRequestSummary {
  const parsed: unknown = JSON.parse(output);
  if (!isRecord(parsed)) {
    throw new Error("GitHub CLI returned an invalid pull request payload.");
  }

  const number = parsed["number"];
  const title = parsed["title"];
  const url = parsed["url"];
  const state = parsed["state"];
  const isDraft = parsed["isDraft"];

  if (
    typeof number !== "number" ||
    typeof title !== "string" ||
    typeof url !== "string" ||
    typeof state !== "string" ||
    typeof isDraft !== "boolean"
  ) {
    throw new Error("GitHub CLI returned an incomplete pull request payload.");
  }

  return {
    isDraft,
    number,
    state,
    title,
    url,
  };
}

async function loadSessionRepositoryStatus(input: {
  cwd: string;
  ensureTransportConnected: SessionWorkbenchTransportManager["ensureTransportConnected"];
  sandboxInstanceId: string;
}): Promise<SessionRepositoryStatus> {
  const gitDirectory = await runRepositoryStatusCommand({
    args: ["rev-parse", "--absolute-git-dir"],
    classifyNotGitRepositoryResult: true,
    command: "git",
    cwd: input.cwd,
    ensureTransportConnected: input.ensureTransportConnected,
    sandboxInstanceId: input.sandboxInstanceId,
  });

  if (gitDirectory === null) {
    return EmptyRepositoryStatus;
  }

  const branchLabel = await runRepositoryStatusCommand({
    args: ["branch", "--show-current"],
    command: "git",
    cwd: input.cwd,
    ensureTransportConnected: input.ensureTransportConnected,
    sandboxInstanceId: input.sandboxInstanceId,
  });

  if (branchLabel === null) {
    return EmptyRepositoryStatus;
  }

  if (
    !(await isGitHubCliAvailable({
      cwd: input.cwd,
      ensureTransportConnected: input.ensureTransportConnected,
      sandboxInstanceId: input.sandboxInstanceId,
    }))
  ) {
    return {
      branchLabel,
      pullRequest: null,
    };
  }

  try {
    const pullRequestOutput = await runRepositoryStatusCommand({
      args: ["pr", "view", "--json", "number,title,url,state,isDraft"],
      command: "gh",
      cwd: input.cwd,
      ensureTransportConnected: input.ensureTransportConnected,
      sandboxInstanceId: input.sandboxInstanceId,
    });

    return {
      branchLabel,
      pullRequest: pullRequestOutput === null ? null : parsePullRequestSummary(pullRequestOutput),
    };
  } catch (error) {
    if (error instanceof Error && /command failed: gh pr view/i.test(error.message)) {
      return {
        branchLabel,
        pullRequest: null,
      };
    }

    throw error;
  }
}

export function useSessionRepositoryStatus(input: {
  connectedAtIso: string | null;
  cwd: string | null;
  enabled: boolean;
  ensureTransportConnected: SessionWorkbenchTransportManager["ensureTransportConnected"];
  refreshEpoch: number;
  sandboxInstanceId: string | null;
}): SessionRepositoryStatus {
  const queryClient = useQueryClient();
  const isRepositoryStatusTrackingEnabled =
    input.enabled && input.sandboxInstanceId !== null && input.cwd !== null;
  const lastSelectionIdentityRef = useRef<string | null>(null);
  const lastRefreshEpochRef = useRef(input.refreshEpoch);
  const queryKey = useMemo(
    () =>
      getSessionRepositoryStatusQueryKey({
        connectedAtIso: input.connectedAtIso,
        sandboxInstanceId: input.sandboxInstanceId,
        cwd: input.cwd,
      }),
    [input.connectedAtIso, input.cwd, input.sandboxInstanceId],
  );
  const selectionIdentity = useMemo(() => queryKey.join("::"), [queryKey]);
  const [freshSelectionIdentity, setFreshSelectionIdentity] = useState<string | null>(null);
  const query = useQuery({
    enabled: isRepositoryStatusTrackingEnabled,
    meta: NoLoadingIndicatorMeta,
    refetchOnMount: "always",
    queryFn: async () => {
      const sandboxInstanceId = input.sandboxInstanceId;
      const cwd = input.cwd;

      if (sandboxInstanceId === null || cwd === null) {
        return EmptyRepositoryStatus;
      }

      return await loadSessionRepositoryStatus({
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
    if (!isRepositoryStatusTrackingEnabled) {
      setFreshSelectionIdentity(null);
      lastSelectionIdentityRef.current = selectionIdentity;
      return;
    }

    setFreshSelectionIdentity(null);
  }, [isRepositoryStatusTrackingEnabled, selectionIdentity]);

  useEffect(() => {
    if (!isRepositoryStatusTrackingEnabled) {
      return;
    }

    const previousSelectionIdentity = lastSelectionIdentityRef.current;
    lastSelectionIdentityRef.current = selectionIdentity;
    const hasCachedSelectionData =
      queryClient.getQueryData<SessionRepositoryStatus>(queryKey) !== undefined;
    if (
      previousSelectionIdentity !== null &&
      previousSelectionIdentity !== selectionIdentity &&
      hasCachedSelectionData
    ) {
      void query.refetch();
    }
  }, [isRepositoryStatusTrackingEnabled, query, queryClient, queryKey, selectionIdentity]);

  useEffect(() => {
    if (!isRepositoryStatusTrackingEnabled) {
      lastRefreshEpochRef.current = input.refreshEpoch;
      return;
    }

    if (lastRefreshEpochRef.current === input.refreshEpoch) {
      return;
    }

    lastRefreshEpochRef.current = input.refreshEpoch;
    void query.refetch();
  }, [input.refreshEpoch, isRepositoryStatusTrackingEnabled, query]);

  useEffect(() => {
    if (!isRepositoryStatusTrackingEnabled || (!query.isFetchedAfterMount && !query.isError)) {
      return;
    }

    setFreshSelectionIdentity(selectionIdentity);
  }, [
    isRepositoryStatusTrackingEnabled,
    query.isError,
    query.isFetchedAfterMount,
    selectionIdentity,
  ]);

  const shouldHideRepositoryStatus =
    !isRepositoryStatusTrackingEnabled ||
    query.isError ||
    freshSelectionIdentity !== selectionIdentity;

  return {
    branchLabel: shouldHideRepositoryStatus ? null : (query.data?.branchLabel ?? null),
    pullRequest: shouldHideRepositoryStatus ? null : (query.data?.pullRequest ?? null),
  };
}
