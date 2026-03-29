import { resolve } from "node:path";

import type { ExecRuntimeInput, ProcessEnvironmentEntry } from "@mistle/sandbox-rs-napi";

import { ProxyCaCertFdEnv, ProxyCaKeyFdEnv } from "../runtime/config.js";

const BootstrapRuntimeCommandName = "bootstrap-runtime";
const RuntimeInternalCommandName = "runtime-internal";

type TargetIdentity = {
  username: string;
  uid: number;
  gid: number;
  homeDir: string;
};

export const HomeEnv = "HOME";
export const LognameEnv = "LOGNAME";
export const PackagedRuntimeBinaryName = "sandboxd";
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

function replaceBootstrapRuntimeCommand(runtimeArgs: readonly string[]): string[] {
  const bootstrapCommandIndex = runtimeArgs.findIndex(
    (argument) => argument === BootstrapRuntimeCommandName,
  );
  if (bootstrapCommandIndex < 0) {
    throw new Error(
      `failed to locate bootstrap runtime command "${BootstrapRuntimeCommandName}" in argv`,
    );
  }

  return runtimeArgs.map((argument, index) =>
    index === bootstrapCommandIndex ? RuntimeInternalCommandName : argument,
  );
}

export function buildRuntimeExecArgs(processArgv: readonly string[]): string[] {
  return replaceBootstrapRuntimeCommand(processArgv.slice(1));
}

export function buildRuntimeExecInput(input: {
  processEnv: NodeJS.ProcessEnv;
  processArgv: readonly string[];
  runtimeEntrypointPath: string;
  targetIdentity: TargetIdentity;
  additionalEnv: Record<string, string>;
}): ExecRuntimeInput {
  const runtimeArgs = buildRuntimeExecArgs(input.processArgv);
  const runtimeEntrypointIndex = runtimeArgs.findIndex(
    (argument) => normalizePathArgument(argument) === input.runtimeEntrypointPath,
  );
  if (runtimeEntrypointIndex < 0) {
    throw new Error(`failed to locate runtime entrypoint "${input.runtimeEntrypointPath}" in argv`);
  }

  const env = buildProcessEnvironmentEntries(input.processEnv);
  env.push(
    {
      name: HomeEnv,
      value: input.targetIdentity.homeDir,
    },
    {
      name: LognameEnv,
      value: input.targetIdentity.username,
    },
    {
      name: UserEnv,
      value: input.targetIdentity.username,
    },
  );

  for (const [name, value] of Object.entries(input.additionalEnv)) {
    env.push({
      name,
      value,
    });
  }

  return {
    uid: input.targetIdentity.uid,
    gid: input.targetIdentity.gid,
    command: process.execPath,
    args: runtimeArgs,
    env,
  };
}

export function buildPackagedRuntimeExecInput(input: {
  processEnv: NodeJS.ProcessEnv;
  processArgv: readonly string[];
  runtimeExecutablePath: string;
  targetIdentity: TargetIdentity;
  additionalEnv: Record<string, string>;
}): ExecRuntimeInput {
  const env = buildProcessEnvironmentEntries(input.processEnv);
  env.push(
    {
      name: HomeEnv,
      value: input.targetIdentity.homeDir,
    },
    {
      name: LognameEnv,
      value: input.targetIdentity.username,
    },
    {
      name: UserEnv,
      value: input.targetIdentity.username,
    },
  );

  for (const [name, value] of Object.entries(input.additionalEnv)) {
    env.push({
      name,
      value,
    });
  }

  return {
    uid: input.targetIdentity.uid,
    gid: input.targetIdentity.gid,
    command: input.runtimeExecutablePath,
    // In SEA entrypoints, user-provided arguments start at process.argv[2].
    args: replaceBootstrapRuntimeCommand(input.processArgv.slice(2)),
    env,
  };
}
