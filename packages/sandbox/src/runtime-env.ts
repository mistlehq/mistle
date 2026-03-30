import { SandboxConfigurationError } from "./errors.js";

export const SandboxRuntimeEnv = {
  LISTEN_ADDR: "SANDBOX_RUNTIME_LISTEN_ADDR",
} as const;

export const SandboxRuntimeEnvDefaults = {
  LISTEN_ADDR: "127.0.0.1:8090",
} as const;

export function withRequiredSandboxRuntimeEnv(
  env: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  const nextEnv = {
    ...(env === undefined ? {} : env),
  };

  assertReservedRuntimeEnvValue(
    nextEnv,
    SandboxRuntimeEnv.LISTEN_ADDR,
    SandboxRuntimeEnvDefaults.LISTEN_ADDR,
  );

  nextEnv[SandboxRuntimeEnv.LISTEN_ADDR] = SandboxRuntimeEnvDefaults.LISTEN_ADDR;

  return nextEnv;
}

function assertReservedRuntimeEnvValue(
  env: Record<string, string>,
  key: string,
  expectedValue: string,
): void {
  const currentValue = env[key];
  if (currentValue === undefined || currentValue === expectedValue) {
    return;
  }

  throw new SandboxConfigurationError(
    `Sandbox runtime env \`${key}\` is reserved and must be ${JSON.stringify(expectedValue)}.`,
  );
}
