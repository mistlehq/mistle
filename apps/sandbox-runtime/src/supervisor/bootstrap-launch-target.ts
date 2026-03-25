import { dirname, extname, join } from "node:path";

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

function resolveBootstrapEntrypointPath(currentEntrypointPath: string): string {
  const extension = extname(currentEntrypointPath);
  const runtimeSuffix = `/main${extension}`;
  if (!currentEntrypointPath.endsWith(runtimeSuffix)) {
    throw new Error(
      `unexpected runtime entrypoint path "${currentEntrypointPath}": expected suffix "${runtimeSuffix}"`,
    );
  }

  return `${currentEntrypointPath.slice(0, -runtimeSuffix.length)}/bootstrap/main${extension}`;
}

export function resolveBootstrapLaunchTarget(
  input: ResolveBootstrapLaunchTargetInput,
): BootstrapLaunchTarget {
  if (input.packagedRuntimeExecutablePath !== undefined) {
    return {
      command: join(dirname(input.packagedRuntimeExecutablePath), "sandbox-bootstrap"),
      args: ["runtime-internal"],
    };
  }

  return {
    command: process.execPath,
    args: [
      ...input.processExecArgv,
      resolveBootstrapEntrypointPath(input.currentEntrypointPath),
      "runtime-internal",
    ],
  };
}
