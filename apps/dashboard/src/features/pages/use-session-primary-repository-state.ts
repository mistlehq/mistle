import { DefaultSandboxWorkspaceDir } from "@mistle/integrations-core";
import { ExecStreamClient } from "@mistle/sandbox-session-client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import type { SessionWorkbenchHeaderRepositoryOption } from "./session-workbench-header-actions.js";
import type { SessionWorkbenchTransportManager } from "./use-session-workbench-transport.js";

const SessionRepositoryDiscoveryTimeoutMs = 15_000;
const SessionRepositoryNoneValue = "__none__";

type SessionRepositoryDiscoveryResult = {
  currentRepositoryPath: string | null;
  repositoryOptions: ReadonlyArray<SessionWorkbenchHeaderRepositoryOption>;
};

type SessionPrimaryRepositoryState = {
  errorMessage: string | null;
  isInitialLoading: boolean;
  isRefreshing: boolean;
  options: ReadonlyArray<SessionWorkbenchHeaderRepositoryOption>;
  refreshRepositories: () => Promise<void>;
  selectedRepositoryPath: string | null;
  setSelectedRepositoryPath: (nextValue: string | null) => void;
};

function toUnavailableSelectedOption(input: {
  selectedRepositoryPath: string;
  workspaceRoot: string;
}): SessionWorkbenchHeaderRepositoryOption {
  const label =
    input.selectedRepositoryPath.startsWith(`${input.workspaceRoot}/`) &&
    input.selectedRepositoryPath.length > input.workspaceRoot.length + 1
      ? input.selectedRepositoryPath.slice(input.workspaceRoot.length + 1)
      : input.selectedRepositoryPath;

  return {
    value: input.selectedRepositoryPath,
    label: `${label} (unavailable)`,
  };
}

async function runExecCommand(input: {
  command: string;
  args?: string[];
  ensureTransportConnected: SessionWorkbenchTransportManager["ensureTransportConnected"];
  sandboxInstanceId: string;
}): Promise<string> {
  const { transport } = await input.ensureTransportConnected({
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const exec = new ExecStreamClient({
    transport,
  });
  const result = await exec.run({
    command: input.command,
    ...(input.args === undefined ? {} : { args: input.args }),
    timeoutMs: SessionRepositoryDiscoveryTimeoutMs,
  });

  if (result.exitCode !== 0) {
    const details = [result.stderr.trim(), result.stdout.trim()].find((value) => value.length > 0);
    throw new Error(details ?? "Repository discovery command failed.");
  }

  return result.stdout;
}

function normalizeRepositoryPath(path: string): string {
  return path.replace(/\/+$/, "");
}

export function buildRepositoryDiscoveryFindArgs(input: { workspaceRoot: string }): string[] {
  return [
    input.workspaceRoot,
    "-mindepth",
    "1",
    "-maxdepth",
    "3",
    "(",
    "-type",
    "d",
    "-o",
    "-type",
    "f",
    ")",
    "-name",
    ".git",
  ];
}

export function parseRepositoryPaths(input: { findOutput: string }): string[] {
  const parsedPaths = input.findOutput
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.endsWith("/.git"))
    .map((line) => normalizeRepositoryPath(line.slice(0, -"/.git".length)));

  return [...new Set(parsedPaths)].sort((left, right) => left.localeCompare(right));
}

export function toRepositoryOptions(input: {
  repositoryPaths: readonly string[];
  workspaceRoot: string;
}): ReadonlyArray<SessionWorkbenchHeaderRepositoryOption> {
  return input.repositoryPaths.map((path) => ({
    value: path,
    label:
      path.startsWith(`${input.workspaceRoot}/`) && path.length > input.workspaceRoot.length + 1
        ? path.slice(input.workspaceRoot.length + 1)
        : path,
  }));
}

export function resolveCurrentRepositoryPath(input: {
  currentWorkingDirectory: string;
  repositoryPaths: readonly string[];
}): string | null {
  const currentWorkingDirectory = normalizeRepositoryPath(input.currentWorkingDirectory.trim());
  const sortedRepositoryPaths = [...input.repositoryPaths].sort((left, right) => {
    if (right.length !== left.length) {
      return right.length - left.length;
    }

    return left.localeCompare(right);
  });

  for (const repositoryPath of sortedRepositoryPaths) {
    if (
      currentWorkingDirectory === repositoryPath ||
      currentWorkingDirectory.startsWith(`${repositoryPath}/`)
    ) {
      return repositoryPath;
    }
  }

  return null;
}

async function loadSessionRepositoryDiscovery(input: {
  ensureTransportConnected: SessionWorkbenchTransportManager["ensureTransportConnected"];
  sandboxInstanceId: string;
}): Promise<SessionRepositoryDiscoveryResult> {
  const [findOutput, workingDirectoryOutput] = await Promise.all([
    runExecCommand({
      args: buildRepositoryDiscoveryFindArgs({
        workspaceRoot: DefaultSandboxWorkspaceDir,
      }),
      command: "find",
      ensureTransportConnected: input.ensureTransportConnected,
      sandboxInstanceId: input.sandboxInstanceId,
    }),
    runExecCommand({
      command: "pwd",
      ensureTransportConnected: input.ensureTransportConnected,
      sandboxInstanceId: input.sandboxInstanceId,
    }),
  ]);
  const repositoryPaths = parseRepositoryPaths({
    findOutput,
  });

  return {
    currentRepositoryPath: resolveCurrentRepositoryPath({
      currentWorkingDirectory: workingDirectoryOutput,
      repositoryPaths,
    }),
    repositoryOptions: toRepositoryOptions({
      repositoryPaths,
      workspaceRoot: DefaultSandboxWorkspaceDir,
    }),
  };
}

export function useSessionPrimaryRepositoryState(input: {
  enabled: boolean;
  ensureTransportConnected: SessionWorkbenchTransportManager["ensureTransportConnected"];
  sandboxInstanceId: string | null;
}): SessionPrimaryRepositoryState {
  const initialSelectionSandboxInstanceIdRef = useRef<string | null>(null);
  const [selectedRepositoryPath, setSelectedRepositoryPath] = useState<string | null>(null);
  const query = useQuery({
    enabled: input.enabled && input.sandboxInstanceId !== null,
    queryFn: async () => {
      const sandboxInstanceId = input.sandboxInstanceId;
      if (sandboxInstanceId === null) {
        throw new Error("Session id is required.");
      }

      return await loadSessionRepositoryDiscovery({
        ensureTransportConnected: input.ensureTransportConnected,
        sandboxInstanceId,
      });
    },
    queryKey: ["session-primary-repository-options", input.sandboxInstanceId],
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const refreshedSelectionMissing =
    selectedRepositoryPath !== null &&
    query.data !== undefined &&
    !query.data.repositoryOptions.some((option) => option.value === selectedRepositoryPath);
  const selectedUnavailableOption =
    refreshedSelectionMissing && selectedRepositoryPath !== null
      ? toUnavailableSelectedOption({
          selectedRepositoryPath,
          workspaceRoot: DefaultSandboxWorkspaceDir,
        })
      : null;
  const repositoryOptions = query.data?.repositoryOptions ?? [];

  useEffect(() => {
    initialSelectionSandboxInstanceIdRef.current = null;
    setSelectedRepositoryPath(null);
  }, [input.sandboxInstanceId]);

  useEffect(() => {
    if (input.sandboxInstanceId === null || query.data === undefined) {
      return;
    }

    if (initialSelectionSandboxInstanceIdRef.current === input.sandboxInstanceId) {
      return;
    }

    initialSelectionSandboxInstanceIdRef.current = input.sandboxInstanceId;
    setSelectedRepositoryPath(query.data.currentRepositoryPath);
  }, [input.sandboxInstanceId, query.data]);

  return {
    errorMessage: query.isError
      ? query.error instanceof Error
        ? query.error.message
        : null
      : refreshedSelectionMissing
        ? "The selected repository is no longer available in this sandbox."
        : null,
    isInitialLoading: query.isLoading,
    isRefreshing: query.isFetching && query.data !== undefined,
    options: [
      {
        label: "None",
        value: SessionRepositoryNoneValue,
      },
      ...(selectedUnavailableOption === null ? [] : [selectedUnavailableOption]),
      ...repositoryOptions,
    ],
    refreshRepositories: async () => {
      await query.refetch();
    },
    selectedRepositoryPath,
    setSelectedRepositoryPath,
  };
}

export { DefaultSandboxWorkspaceDir, SessionRepositoryNoneValue };
export type { SessionPrimaryRepositoryState, SessionRepositoryDiscoveryResult };
