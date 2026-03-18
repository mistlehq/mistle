import type { CompiledRuntimeClient, RuntimeClientProcessSpec } from "@mistle/integrations-core";

export function mergeRuntimeClientProcessEnv(
  runtimeClientEnv: Record<string, string>,
  processCommandEnv: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (
    Object.keys(runtimeClientEnv).length === 0 &&
    (processCommandEnv === undefined || Object.keys(processCommandEnv).length === 0)
  ) {
    return undefined;
  }

  return {
    ...runtimeClientEnv,
    ...processCommandEnv,
  };
}

export function flattenRuntimeClientProcesses(
  runtimeClients: ReadonlyArray<CompiledRuntimeClient>,
): RuntimeClientProcessSpec[] {
  const processes: RuntimeClientProcessSpec[] = [];

  for (const runtimeClient of runtimeClients) {
    for (const process of runtimeClient.processes) {
      const mergedEnv = mergeRuntimeClientProcessEnv(runtimeClient.setup.env, process.command.env);
      const { env: _processCommandEnv, ...processCommand } = process.command;
      processes.push({
        ...process,
        command: {
          ...processCommand,
          ...(mergedEnv === undefined
            ? {}
            : {
                env: mergedEnv,
              }),
        },
      });
    }
  }

  return processes;
}
