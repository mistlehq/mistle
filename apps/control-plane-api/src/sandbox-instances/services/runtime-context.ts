import type { CompiledRuntimePlan } from "@mistle/integrations-core";

export type SandboxInstanceAgentRuntimeId = "codex" | "opencode";

function normalizePath(path: string): string {
  return path.replace(/\/+$/, "");
}

function resolveLaunchCwd(runtimePlan: CompiledRuntimePlan | null): string | null {
  if (runtimePlan === null) {
    return null;
  }

  for (const agentRuntime of runtimePlan.agentRuntimes) {
    const launchCwd =
      agentRuntime.ptyLaunch.newLaunch.cwd ?? agentRuntime.ptyLaunch.resumeLaunch.cwd;
    if (launchCwd !== undefined) {
      return normalizePath(launchCwd);
    }
  }

  return null;
}

function resolveRepositoryRoot(input: {
  launchCwd: string;
  runtimePlan: CompiledRuntimePlan;
}): string | null {
  const repositoryRoots = input.runtimePlan.workspaceSources
    .filter((workspaceSource) => workspaceSource.resourceKind === "repository")
    .map((workspaceSource) => normalizePath(workspaceSource.path))
    .sort((left, right) => {
      if (right.length !== left.length) {
        return right.length - left.length;
      }

      return left.localeCompare(right);
    });

  for (const repositoryRoot of repositoryRoots) {
    if (input.launchCwd === repositoryRoot || input.launchCwd.startsWith(`${repositoryRoot}/`)) {
      return repositoryRoot;
    }
  }

  return null;
}

function resolveAgentRuntimeId(
  runtimePlan: CompiledRuntimePlan,
): SandboxInstanceAgentRuntimeId | null {
  const agentRuntime = runtimePlan.agentRuntimes[0];
  if (agentRuntime === undefined) {
    return null;
  }
  if (agentRuntime.runtimeId !== "codex" && agentRuntime.runtimeId !== "opencode") {
    throw new Error(`Unsupported sandbox instance agent runtime '${agentRuntime.runtimeId}'.`);
  }
  return agentRuntime.runtimeId;
}

export type SandboxInstanceRuntimeContext = {
  agentRuntimeId: SandboxInstanceAgentRuntimeId | null;
  launchCwd: string | null;
  primaryRepositoryRoot: string | null;
};

export function resolveSandboxInstanceRuntimeContext(input: {
  runtimePlan: CompiledRuntimePlan | null;
}): SandboxInstanceRuntimeContext | null {
  if (input.runtimePlan === null) {
    return null;
  }

  const launchCwd = resolveLaunchCwd(input.runtimePlan);
  if (launchCwd === null) {
    return {
      agentRuntimeId: resolveAgentRuntimeId(input.runtimePlan),
      launchCwd: null,
      primaryRepositoryRoot: null,
    };
  }

  return {
    agentRuntimeId: resolveAgentRuntimeId(input.runtimePlan),
    launchCwd,
    primaryRepositoryRoot: resolveRepositoryRoot({
      launchCwd,
      runtimePlan: input.runtimePlan,
    }),
  };
}
