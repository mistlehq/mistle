import type { ConnectionOpts, SandboxConnectOpts, SandboxOpts } from "e2b";

export const E2BHobbySandboxTimeoutMs = 60 * 60 * 1000;

export function createE2BSandboxCreateOptions(input: {
  connectionOptions: ConnectionOpts;
  templateAlias: string;
  envs: Record<string, string>;
}): SandboxOpts {
  return {
    ...input.connectionOptions,
    timeoutMs: E2BHobbySandboxTimeoutMs,
    lifecycle: {
      onTimeout: "pause",
    },
    metadata: {
      mistle_template_alias: input.templateAlias,
    },
    envs: input.envs,
  };
}

export function createE2BSandboxConnectOptions(
  connectionOptions: ConnectionOpts,
): SandboxConnectOpts {
  return {
    ...connectionOptions,
    timeoutMs: E2BHobbySandboxTimeoutMs,
  };
}
