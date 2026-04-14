import type { CompiledRuntimePlan } from "@mistle/integrations-core";

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

export type SandboxInstanceRuntimeContext = {
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
      launchCwd: null,
      primaryRepositoryRoot: null,
    };
  }

  return {
    launchCwd,
    primaryRepositoryRoot: resolveRepositoryRoot({
      launchCwd,
      runtimePlan: input.runtimePlan,
    }),
  };
}
