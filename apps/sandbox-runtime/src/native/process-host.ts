import { spawnManagedProcess, type ProcessExitResult } from "@mistle/sandbox-rs-napi";

type ProcessEnvironmentEntry = {
  name: string;
  value: string;
};

export type NativeProcessSignal = "sigterm" | "sigkill";

export type StartNativeManagedProcessInput = {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  onExit: (result: ProcessExitResult) => void;
};

function buildEnvironmentEntries(
  overrides: Record<string, string> | undefined,
): ProcessEnvironmentEntry[] | undefined {
  if (overrides === undefined) {
    return undefined;
  }

  const environment: Record<string, string> = {};

  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined) {
      continue;
    }

    environment[name] = value;
  }

  for (const [name, value] of Object.entries(overrides)) {
    environment[name] = value;
  }

  return Object.entries(environment).map(([name, value]) => ({
    name,
    value,
  }));
}

export function startNativeManagedProcess(input: StartNativeManagedProcessInput) {
  const environmentEntries = buildEnvironmentEntries(input.env);

  return spawnManagedProcess(
    {
      command: input.command,
      args: input.args,
      ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
      ...(environmentEntries === undefined ? {} : { env: environmentEntries }),
    },
    input.onExit,
  );
}
