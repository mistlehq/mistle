import { DefaultSandboxWorkspaceDir } from "@mistle/integrations-core";
import { ExecStreamClient } from "@mistle/sandbox-session-client";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import { NoLoadingIndicatorMeta } from "../shared/loading-indicator-meta.js";
import {
  buildRepositoryDiscoveryFindArgs,
  parseRepositoryPaths,
  resolvePrimaryRepositoryPresentation,
  toRepositoryOptions,
} from "./session-primary-repository-policy.js";
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

type SelectedRepositoryState = {
  hasUserSelected: boolean;
  sandboxInstanceId: string | null;
  selectedRepositoryPath: string | null;
};

function createInitialSelectedRepositoryState(input: {
  initialSelectedRepositoryPath: string | null | undefined;
  sandboxInstanceId: string | null;
}): SelectedRepositoryState {
  return {
    hasUserSelected: false,
    sandboxInstanceId: input.sandboxInstanceId,
    selectedRepositoryPath: input.initialSelectedRepositoryPath ?? null,
  };
}

function resolveSelectedRepositoryState(input: {
  currentState: SelectedRepositoryState;
  initialSelectedRepositoryPath: string | null | undefined;
  sandboxInstanceId: string | null;
}): SelectedRepositoryState {
  if (input.currentState.sandboxInstanceId !== input.sandboxInstanceId) {
    return createInitialSelectedRepositoryState({
      initialSelectedRepositoryPath: input.initialSelectedRepositoryPath,
      sandboxInstanceId: input.sandboxInstanceId,
    });
  }

  if (
    !input.currentState.hasUserSelected &&
    input.initialSelectedRepositoryPath !== undefined &&
    input.currentState.selectedRepositoryPath !== input.initialSelectedRepositoryPath
  ) {
    return {
      ...input.currentState,
      selectedRepositoryPath: input.initialSelectedRepositoryPath,
    };
  }

  return input.currentState;
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
  runtimeDisplayName: string;
  sandboxInstanceId: string | null;
}): SessionPrimaryRepositoryState {
  const [selectedRepositoryState, setSelectedRepositoryState] = useState<SelectedRepositoryState>(
    () =>
      createInitialSelectedRepositoryState({
        initialSelectedRepositoryPath: input.initialSelectedRepositoryPath,
        sandboxInstanceId: input.sandboxInstanceId,
      }),
  );
  const currentSandboxSelectionState = resolveSelectedRepositoryState({
    currentState: selectedRepositoryState,
    initialSelectedRepositoryPath: input.initialSelectedRepositoryPath,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const selectedRepositoryPath = currentSandboxSelectionState.selectedRepositoryPath;
  const query = useQuery({
    enabled: input.enabled && input.sandboxInstanceId !== null,
    meta: NoLoadingIndicatorMeta,
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
  const queryErrorMessage =
    query.isError && query.error instanceof Error ? query.error.message : null;
  const presentation = resolvePrimaryRepositoryPresentation({
    repositoryOptions,
    selectedRepositoryPath,
    queryErrorMessage,
    queryState: query.isError ? "error" : query.data !== undefined ? "loaded" : "idle",
    runtimeDisplayName: input.runtimeDisplayName,
    workspaceRoot: DefaultSandboxWorkspaceDir,
  });

  useEffect(() => {
    setSelectedRepositoryState((currentState) =>
      resolveSelectedRepositoryState({
        currentState,
        initialSelectedRepositoryPath: input.initialSelectedRepositoryPath,
        sandboxInstanceId: input.sandboxInstanceId,
      }),
    );
  }, [input.initialSelectedRepositoryPath, input.sandboxInstanceId]);

  const handleSetSelectedRepositoryPath = useCallback(
    (nextValue: string | null) => {
      setSelectedRepositoryState({
        hasUserSelected: true,
        sandboxInstanceId: input.sandboxInstanceId,
        selectedRepositoryPath: nextValue,
      });
    },
    [input.sandboxInstanceId],
  );

  return {
    errorMessage: presentation.errorMessage,
    isInitialLoading: query.isLoading,
    isRefreshing: query.isFetching && query.data !== undefined,
    options: [
      {
        label: "None",
        value: SessionRepositoryNoneValue,
      },
      ...presentation.options,
    ],
    refreshRepositories: async () => {
      await query.refetch();
    },
    selectedRepositoryPath,
    setSelectedRepositoryPath: handleSetSelectedRepositoryPath,
  };
}

export { SessionRepositoryNoneValue };
export type { SessionPrimaryRepositoryState, SessionRepositoryDiscoveryResult };
