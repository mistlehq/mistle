import { DefaultSandboxWorkspaceDir } from "@mistle/integrations-core";
import type { CodexThreadSummary } from "@mistle/integrations-definitions/agent-runtimes/codex/client";

export type PrimaryRepositoryThreadSwitchAction =
  | {
      type: "resume_existing_thread";
      threadId: string;
    }
  | {
      type: "start_new_thread";
      cwd: string;
    };

export function resolvePrimaryRepositoryThreadSwitchCwd(input: {
  selectedRepositoryPath: string | null;
}): string {
  return input.selectedRepositoryPath ?? DefaultSandboxWorkspaceDir;
}

export function resolvePrimaryRepositoryThreadSwitchAction(input: {
  matchingThreads: readonly CodexThreadSummary[];
  selectedRepositoryPath: string | null;
}): PrimaryRepositoryThreadSwitchAction {
  const selectedThread = [...input.matchingThreads].sort((left, right) => {
    const leftUpdatedAt = left.updatedAt ?? left.createdAt ?? Number.NEGATIVE_INFINITY;
    const rightUpdatedAt = right.updatedAt ?? right.createdAt ?? Number.NEGATIVE_INFINITY;
    if (rightUpdatedAt !== leftUpdatedAt) {
      return rightUpdatedAt - leftUpdatedAt;
    }

    return left.id.localeCompare(right.id);
  })[0];

  if (selectedThread !== undefined) {
    return {
      type: "resume_existing_thread",
      threadId: selectedThread.id,
    };
  }

  return {
    type: "start_new_thread",
    cwd: resolvePrimaryRepositoryThreadSwitchCwd({
      selectedRepositoryPath: input.selectedRepositoryPath,
    }),
  };
}
