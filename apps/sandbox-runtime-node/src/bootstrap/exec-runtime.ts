import { resolve } from "node:path";

import {
  execRuntimeAsUser,
  type ExecRuntimeAsUserInput,
  type ProcessEnvironmentEntry,
} from "@mistle/sandbox-rs-napi";

import { ProxyCaCertFdEnv, ProxyCaKeyFdEnv } from "../runtime/config.js";

type SandboxUserRecord = {
  username: string;
  uid: number;
  gid: number;
  homeDir: string;
};

export const HomeEnv = "HOME";
export const LognameEnv = "LOGNAME";
export const UserEnv = "USER";

function normalizePathArgument(argument: string): string {
  return resolve(process.cwd(), argument);
}

function buildProcessEnvironmentEntries(environment: NodeJS.ProcessEnv): ProcessEnvironmentEntry[] {
  const entries: ProcessEnvironmentEntry[] = [];

  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined) {
      continue;
    }

    if (
      name === HomeEnv ||
      name === LognameEnv ||
      name === UserEnv ||
      name === ProxyCaCertFdEnv ||
      name === ProxyCaKeyFdEnv
    ) {
      continue;
    }

    entries.push({
      name,
      value,
    });
  }

  return entries;
}

export function buildRuntimeExecArgs(
  processArgv: readonly string[],
  bootstrapEntrypointPath: string,
  runtimeEntrypointPath: string,
): string[] {
  const runtimeArgs = processArgv.slice(1);
  const bootstrapEntrypointIndex = runtimeArgs.findIndex(
    (argument) => normalizePathArgument(argument) === bootstrapEntrypointPath,
  );

  if (bootstrapEntrypointIndex < 0) {
    throw new Error(`failed to locate bootstrap entrypoint "${bootstrapEntrypointPath}" in argv`);
  }

  return runtimeArgs.map((argument, index) =>
    index === bootstrapEntrypointIndex ? runtimeEntrypointPath : argument,
  );
}

export function buildRuntimeExecInput(input: {
  processEnv: NodeJS.ProcessEnv;
  processArgv: readonly string[];
  bootstrapEntrypointPath: string;
  runtimeEntrypointPath: string;
  userRecord: SandboxUserRecord;
  additionalEnv: Record<string, string>;
}): ExecRuntimeAsUserInput {
  const env = buildProcessEnvironmentEntries(input.processEnv);
  env.push(
    {
      name: HomeEnv,
      value: input.userRecord.homeDir,
    },
    {
      name: LognameEnv,
      value: input.userRecord.username,
    },
    {
      name: UserEnv,
      value: input.userRecord.username,
    },
  );

  for (const [name, value] of Object.entries(input.additionalEnv)) {
    env.push({
      name,
      value,
    });
  }

  return {
    uid: input.userRecord.uid,
    gid: input.userRecord.gid,
    command: process.execPath,
    args: buildRuntimeExecArgs(
      input.processArgv,
      input.bootstrapEntrypointPath,
      input.runtimeEntrypointPath,
    ),
    env,
  };
}

export function execRuntime(input: ExecRuntimeAsUserInput): never {
  execRuntimeAsUser(input);
  throw new Error("sandbox runtime exec returned unexpectedly");
}
