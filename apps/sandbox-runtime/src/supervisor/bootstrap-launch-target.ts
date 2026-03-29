export type BootstrapLaunchTarget = {
  command: string;
  args: string[];
};

type ResolveBootstrapLaunchTargetInput =
  | {
      processExecArgv: readonly string[];
      currentEntrypointPath: string;
      packagedRuntimeExecutablePath?: undefined;
    }
  | {
      processExecArgv: readonly string[];
      currentEntrypointPath?: undefined;
      packagedRuntimeExecutablePath: string;
    };

export function resolveBootstrapLaunchTarget(
  input: ResolveBootstrapLaunchTargetInput,
): BootstrapLaunchTarget {
  // Supervisor always enters through bootstrap-runtime. Bootstrap owns the
  // root-only setup phase, then execs back into runtime-internal once startup
  // material and proxy CA state are ready.
  if (input.packagedRuntimeExecutablePath !== undefined) {
    return {
      command: input.packagedRuntimeExecutablePath,
      args: ["bootstrap-runtime"],
    };
  }

  return {
    command: process.execPath,
    args: [...input.processExecArgv, input.currentEntrypointPath, "bootstrap-runtime"],
  };
}
