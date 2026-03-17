import { spawnPty } from "@mistle/sandbox-rs-napi";

const DEFAULT_PTY_SHELL = "/bin/sh";
const PREFERRED_TERM = "xterm-256color";

type SpawnPtyHostInput = {
  cwd?: string;
  cols?: number;
  rows?: number;
};

type SpawnPtyHostCallbacks = {
  onEvent: (event: {
    kind: string;
    data?: Uint8Array;
    exitCode?: number;
    message?: string;
  }) => void;
};

type PtyEnvironmentEntry = {
  name: string;
  value: string;
};

function resolvePtyEnvironment(): PtyEnvironmentEntry[] {
  const environmentEntries: PtyEnvironmentEntry[] = [];

  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined) {
      continue;
    }

    environmentEntries.push({
      name,
      value,
    });
  }

  environmentEntries.push({
    name: "TERM",
    value: PREFERRED_TERM,
  });

  return environmentEntries;
}

export function startNativePtySession(input: SpawnPtyHostInput, callbacks: SpawnPtyHostCallbacks) {
  return spawnPty(
    {
      command: DEFAULT_PTY_SHELL,
      args: ["-i"],
      env: resolvePtyEnvironment(),
      ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
      ...(input.cols === undefined ? {} : { cols: input.cols }),
      ...(input.rows === undefined ? {} : { rows: input.rows }),
    },
    callbacks.onEvent,
  );
}
