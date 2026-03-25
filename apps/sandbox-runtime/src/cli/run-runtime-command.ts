import { type Readable, type Writable } from "node:stream";

import { runRuntime } from "../runtime/run.js";
import { resolveBootstrapLaunchTarget } from "../supervisor/bootstrap-launch-target.js";
import { type BootstrapLaunchTarget } from "../supervisor/bootstrap-launch-target.js";
import { applyStartupToSupervisor } from "../supervisor/client.js";
import { startSupervisorServer } from "../supervisor/server.js";

type LookupEnv = (key: string) => string | undefined;

type RunRuntimeCommandInput = {
  lookupEnv: LookupEnv;
  stdin: Readable;
  stderr: Writable;
  processArgv: readonly string[];
  processExecArgv: readonly string[];
  currentEntrypointPath?: string;
  packagedRuntimeExecutablePath?: string;
};

type RuntimeCommandName = "serve" | "apply-startup" | "runtime-internal";

function resolveRuntimeCommandName(processArgv: readonly string[]): RuntimeCommandName {
  const commandName = processArgv[2];
  if (commandName === undefined) {
    return "serve";
  }

  switch (commandName) {
    case "serve":
    case "apply-startup":
    case "runtime-internal":
      return commandName;
    default:
      throw new Error(`unsupported sandbox runtime command "${commandName}"`);
  }
}

function resolveServeBootstrapLaunchTarget(
  input: Pick<
    RunRuntimeCommandInput,
    "currentEntrypointPath" | "packagedRuntimeExecutablePath" | "processExecArgv"
  >,
): BootstrapLaunchTarget {
  if (input.packagedRuntimeExecutablePath !== undefined) {
    return resolveBootstrapLaunchTarget({
      packagedRuntimeExecutablePath: input.packagedRuntimeExecutablePath,
      processExecArgv: input.processExecArgv,
    });
  }

  if (input.currentEntrypointPath === undefined) {
    throw new Error("runtime entrypoint path is required for serve mode");
  }

  return resolveBootstrapLaunchTarget({
    currentEntrypointPath: input.currentEntrypointPath,
    processExecArgv: input.processExecArgv,
  });
}

export async function runRuntimeCommand(input: RunRuntimeCommandInput): Promise<void> {
  switch (resolveRuntimeCommandName(input.processArgv)) {
    case "serve": {
      const supervisor = await startSupervisorServer({
        lookupEnv: input.lookupEnv,
        bootstrapLaunchTarget: resolveServeBootstrapLaunchTarget(input),
        stderr: input.stderr,
      });

      const closeSupervisor = (): void => {
        void supervisor.close().catch(() => undefined);
      };
      process.once("SIGINT", closeSupervisor);
      process.once("SIGTERM", closeSupervisor);

      try {
        await supervisor.closed;
      } finally {
        process.off("SIGINT", closeSupervisor);
        process.off("SIGTERM", closeSupervisor);
      }
      return;
    }
    case "apply-startup":
      await applyStartupToSupervisor({
        lookupEnv: input.lookupEnv,
        stdin: input.stdin,
      });
      return;
    case "runtime-internal":
      await runRuntime({
        lookupEnv: input.lookupEnv,
        stdin: input.stdin,
      });
      return;
  }
}
