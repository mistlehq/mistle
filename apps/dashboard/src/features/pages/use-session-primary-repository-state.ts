import { DefaultSandboxWorkspaceDir, type CompiledRuntimePlan } from "@mistle/integrations-core";
import { ExecStreamClient } from "@mistle/sandbox-session-client";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import type { SessionWorkbenchHeaderRepositoryOption } from "./session-workbench-header-actions.js";
import type { SessionWorkbenchTransportManager } from "./use-session-workbench-transport.js";

const SessionRepositoryDiscoveryTimeoutMs = 15_000;
const SessionRepositoryNoneValue = "__none__";

type SessionRepositoryDiscoveryResult = {
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

export function resolveRepositoryPathFromWorkingDirectory(input: {
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

export function resolveRuntimePlanPrimaryRepositoryCwd(input: {
  runtimePlan: CompiledRuntimePlan | null | undefined;
}): string | null | undefined {
  if (input.runtimePlan === undefined) {
    return undefined;
  }

  for (const agentRuntime of input.runtimePlan?.agentRuntimes ?? []) {
    const primaryRepositoryCwd =
      agentRuntime.ptyLaunch.newLaunch.cwd ?? agentRuntime.ptyLaunch.resumeLaunch.cwd;
    if (primaryRepositoryCwd !== undefined) {
      return normalizeRepositoryPath(primaryRepositoryCwd);
    }
  }

  return null;
}

export function resolveRuntimePlanPrimaryRepositoryPath(input: {
  runtimePlan: CompiledRuntimePlan | null | undefined;
}): string | null | undefined {
  const primaryRepositoryCwd = resolveRuntimePlanPrimaryRepositoryCwd(input);
  if (primaryRepositoryCwd === undefined || primaryRepositoryCwd === null) {
    return primaryRepositoryCwd;
  }

  const repositoryPaths = (input.runtimePlan?.workspaceSources ?? [])
    .filter((workspaceSource) => workspaceSource.resourceKind === "repository")
    .map((workspaceSource) => normalizeRepositoryPath(workspaceSource.path));

  return resolveRepositoryPathFromWorkingDirectory({
    currentWorkingDirectory: primaryRepositoryCwd,
    repositoryPaths,
  });
}

async function loadSessionRepositoryDiscovery(input: {
  ensureTransportConnected: SessionWorkbenchTransportManager["ensureTransportConnected"];
  sandboxInstanceId: string;
}): Promise<SessionRepositoryDiscoveryResult> {
  const findOutput = await runExecCommand({
    args: buildRepositoryDiscoveryFindArgs({
      workspaceRoot: DefaultSandboxWorkspaceDir,
    }),
    command: "find",
    ensureTransportConnected: input.ensureTransportConnected,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const repositoryPaths = parseRepositoryPaths({
    findOutput,
  });

  return {
    repositoryOptions: toRepositoryOptions({
      repositoryPaths,
      workspaceRoot: DefaultSandboxWorkspaceDir,
    }),
  };
}

export function useSessionPrimaryRepositoryState(input: {
  enabled: boolean;
  ensureTransportConnected: SessionWorkbenchTransportManager["ensureTransportConnected"];
  initialSelectedRepositoryPath?: string | null;
  sandboxInstanceId: string | null;
}): SessionPrimaryRepositoryState {
  const hasHydratedInitialSelectionRef = useRef(false);
  const lastAppliedInitialSelectionRef = useRef<string | null | undefined>(undefined);
  const userSelectionTouchedRef = useRef(false);
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
  const repositoryOptions = query.data?.repositoryOptions ?? [];

  useEffect(() => {
    hasHydratedInitialSelectionRef.current = false;
    lastAppliedInitialSelectionRef.current = undefined;
    userSelectionTouchedRef.current = false;
    setSelectedRepositoryPath(null);
  }, [input.sandboxInstanceId]);

  useEffect(() => {
    if (input.sandboxInstanceId === null || input.initialSelectedRepositoryPath === undefined) {
      return;
    }

    if (!hasHydratedInitialSelectionRef.current) {
      hasHydratedInitialSelectionRef.current = true;
      lastAppliedInitialSelectionRef.current = input.initialSelectedRepositoryPath;
      setSelectedRepositoryPath(input.initialSelectedRepositoryPath);
      return;
    }

    if (
      userSelectionTouchedRef.current ||
      lastAppliedInitialSelectionRef.current !== null ||
      input.initialSelectedRepositoryPath === null ||
      selectedRepositoryPath !== null
    ) {
      return;
    }

    lastAppliedInitialSelectionRef.current = input.initialSelectedRepositoryPath;
    setSelectedRepositoryPath(input.initialSelectedRepositoryPath);
  }, [input.initialSelectedRepositoryPath, input.sandboxInstanceId, selectedRepositoryPath]);

  const handleSetSelectedRepositoryPath = useCallback((nextValue: string | null) => {
    userSelectionTouchedRef.current = true;
    setSelectedRepositoryPath(nextValue);
  }, []);

  return {
    errorMessage: query.isError
      ? query.error instanceof Error
        ? query.error.message
        : null
      : null,
    isInitialLoading: query.isLoading,
    isRefreshing: query.isFetching && query.data !== undefined,
    options: [
      {
        label: "None",
        value: SessionRepositoryNoneValue,
      },
      ...repositoryOptions,
    ],
    refreshRepositories: async () => {
      await query.refetch();
    },
    selectedRepositoryPath,
    setSelectedRepositoryPath: handleSetSelectedRepositoryPath,
  };
}

export { DefaultSandboxWorkspaceDir, SessionRepositoryNoneValue };
export type { SessionPrimaryRepositoryState, SessionRepositoryDiscoveryResult };
