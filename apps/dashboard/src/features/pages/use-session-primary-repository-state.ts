import { DefaultSandboxWorkspaceDir } from "@mistle/integrations-core";
import { ExecStreamClient } from "@mistle/sandbox-session-client";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

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
  sandboxInstanceId: string | null;
}): SessionPrimaryRepositoryState {
  const lastAutoAppliedInitialSelectionRef = useRef<string | null | undefined>(undefined);
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
  const queryErrorMessage =
    query.isError && query.error instanceof Error
      ? query.error.message
      : query.isError
        ? null
        : null;
  const presentation = resolvePrimaryRepositoryPresentation({
    repositoryOptions,
    selectedRepositoryPath,
    queryErrorMessage,
    queryState: query.isError ? "error" : query.data !== undefined ? "loaded" : "idle",
    workspaceRoot: DefaultSandboxWorkspaceDir,
  });

  useEffect(() => {
    lastAutoAppliedInitialSelectionRef.current = undefined;
    userSelectionTouchedRef.current = false;
    setSelectedRepositoryPath(null);
  }, [input.sandboxInstanceId]);

  useEffect(() => {
    if (input.sandboxInstanceId === null || input.initialSelectedRepositoryPath === undefined) {
      return;
    }

    if (userSelectionTouchedRef.current) {
      return;
    }

    if (
      lastAutoAppliedInitialSelectionRef.current === input.initialSelectedRepositoryPath ||
      (lastAutoAppliedInitialSelectionRef.current !== undefined && selectedRepositoryPath !== null)
    ) {
      return;
    }

    lastAutoAppliedInitialSelectionRef.current = input.initialSelectedRepositoryPath;
    setSelectedRepositoryPath(input.initialSelectedRepositoryPath);
  }, [input.initialSelectedRepositoryPath, input.sandboxInstanceId, selectedRepositoryPath]);

  const handleSetSelectedRepositoryPath = useCallback((nextValue: string | null) => {
    userSelectionTouchedRef.current = true;
    setSelectedRepositoryPath(nextValue);
  }, []);

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

export { DefaultSandboxWorkspaceDir, SessionRepositoryNoneValue };
export type { SessionPrimaryRepositoryState, SessionRepositoryDiscoveryResult };
