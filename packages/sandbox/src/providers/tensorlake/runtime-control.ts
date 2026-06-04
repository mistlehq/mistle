import {
  SandboxConfigurationError,
  SandboxProviderNotImplementedError,
  SandboxResourceNotFoundError,
} from "../../errors.js";
import {
  resolveSandboxdOperationLogPath,
  SandboxdOperationLogPaths,
} from "../../operation-log-paths.js";
import {
  SandboxdInstallCommand,
  SandboxdInstallEnvVars,
  SandboxdResetTransparentEgressNftablesCommand,
  SandboxdStopDaemonCommand,
} from "../../sandboxd-install.js";
import type {
  SandboxRuntimeControl,
  SandboxRuntimeControlRequest,
  SandboxRuntimeEnsureSandboxdRequest,
  SandboxRuntimeOperationLog,
} from "../../types.js";
import { withSandboxProviderOperationTelemetry } from "../telemetry.js";
import {
  TensorlakeClientError,
  TensorlakeClientErrorCodes,
  TensorlakeClientOperationIds,
} from "./client-errors.js";
import { ShutdownCommandArgs, TensorlakeRootProcessUser, type TensorlakeClient } from "./client.js";

export { SandboxdOperationLogPaths };

const SandboxdEnsureTimeoutMs = 120_000;
export const SandboxdStopDaemonTimeoutMs = 30_000;
export const SandboxdResetTransparentEgressNftablesTimeoutMs = 10_000;
export const SandboxdReadOperationLogTimeoutMs = 60_000;
const TensorlakeRootShellCommand = "sh";
const TensorlakeRootShellCommandArgs = ["-euc"];

function reportGracefulShutdownFailure(input: {
  provider: "tensorlake";
  sandboxId: string;
  error: unknown;
}): void {
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  process.stderr.write(
    `Mistle ${input.provider} sandbox '${input.sandboxId}' graceful sandboxd shutdown failed before hard daemon stop: ${message}\n`,
  );
}

export function createTensorlakeRootShellCommand(input: { script: string }): {
  command: string;
  args: readonly string[];
} {
  return {
    command: TensorlakeRootShellCommand,
    args: [...TensorlakeRootShellCommandArgs, input.script],
  };
}

function requireSandboxId(id: string): void {
  if (id.trim().length === 0) {
    throw new SandboxConfigurationError("Sandbox id is required.");
  }
}

function toSandboxNotFoundError(resourceId: string, error: unknown): SandboxResourceNotFoundError {
  return new SandboxResourceNotFoundError({
    resourceType: "sandbox",
    resourceId,
    cause: error,
  });
}

export class TensorlakeSandboxRuntimeControl implements SandboxRuntimeControl {
  readonly #client: TensorlakeClient;

  constructor(client: TensorlakeClient) {
    this.#client = client;
  }

  async readSandboxdVersion(input: {
    id: string;
    env?: Readonly<Record<string, string>>;
  }): Promise<string> {
    requireSandboxId(input.id);

    return await withSandboxProviderOperationTelemetry({
      provider: "tensorlake",
      operation: TensorlakeClientOperationIds.READ_SANDBOXD_VERSION,
      fn: async () => {
        try {
          const result = await this.#client.runCommand({
            sandboxId: input.id,
            operation: TensorlakeClientOperationIds.READ_SANDBOXD_VERSION,
            commandDescription: "Read sandboxd version",
            command: "/opt/mistle/bin/sandboxd",
            args: ["version"],
            ...(input.env === undefined ? {} : { env: { ...input.env } }),
          });
          const version = result.stdout.trim();
          if (version.length === 0) {
            throw new Error("Tensorlake sandboxd version command returned empty stdout.");
          }

          return version;
        } catch (error) {
          if (
            error instanceof TensorlakeClientError &&
            error.code === TensorlakeClientErrorCodes.NOT_FOUND
          ) {
            throw toSandboxNotFoundError(input.id, error);
          }
          throw error;
        }
      },
    });
  }

  async ensureSandboxd(input: SandboxRuntimeEnsureSandboxdRequest): Promise<void> {
    requireSandboxId(input.id);

    await withSandboxProviderOperationTelemetry({
      provider: "tensorlake",
      operation: TensorlakeClientOperationIds.ENSURE_SANDBOXD,
      fn: async () => {
        try {
          await this.#client.runCommand({
            sandboxId: input.id,
            operation: TensorlakeClientOperationIds.STOP_SANDBOXD_DAEMON,
            commandDescription: "Stop sandboxd daemon",
            ...createTensorlakeRootShellCommand({ script: SandboxdStopDaemonCommand }),
            user: TensorlakeRootProcessUser,
            timeoutMs: SandboxdStopDaemonTimeoutMs,
          });
          await this.#client.runCommand({
            sandboxId: input.id,
            operation: TensorlakeClientOperationIds.RESET_TRANSPARENT_EGRESS_NFTABLES,
            commandDescription: "Reset transparent egress nftables",
            ...createTensorlakeRootShellCommand({
              script: SandboxdResetTransparentEgressNftablesCommand,
            }),
            user: TensorlakeRootProcessUser,
            timeoutMs: SandboxdResetTransparentEgressNftablesTimeoutMs,
          });
          await this.#client.runCommand({
            sandboxId: input.id,
            operation: TensorlakeClientOperationIds.ENSURE_SANDBOXD,
            commandDescription: "Ensure sandboxd artifact",
            ...createTensorlakeRootShellCommand({ script: SandboxdInstallCommand }),
            env: {
              [SandboxdInstallEnvVars.URL]: input.artifact.url,
              [SandboxdInstallEnvVars.SHA256]: input.artifact.sha256,
              [SandboxdInstallEnvVars.VERSION]: input.artifact.version,
            },
            user: TensorlakeRootProcessUser,
            timeoutMs: SandboxdEnsureTimeoutMs,
          });
        } catch (error) {
          if (
            error instanceof TensorlakeClientError &&
            error.code === TensorlakeClientErrorCodes.NOT_FOUND
          ) {
            throw toSandboxNotFoundError(input.id, error);
          }
          throw error;
        }
      },
    });
  }

  async activate(input: SandboxRuntimeControlRequest): Promise<void> {
    requireSandboxId(input.id);

    await withSandboxProviderOperationTelemetry({
      provider: "tensorlake",
      operation: TensorlakeClientOperationIds.ACTIVATE,
      fn: async () => {
        try {
          await this.#client.activate({
            sandboxId: input.id,
            payload: input.payload,
            ...(input.env === undefined ? {} : { env: input.env }),
          });
        } catch (error) {
          if (
            error instanceof TensorlakeClientError &&
            error.code === TensorlakeClientErrorCodes.NOT_FOUND
          ) {
            throw toSandboxNotFoundError(input.id, error);
          }
          throw error;
        }
      },
    });
  }

  async shutdown(input: { id: string; env?: Readonly<Record<string, string>> }): Promise<void> {
    requireSandboxId(input.id);

    await withSandboxProviderOperationTelemetry({
      provider: "tensorlake",
      operation: TensorlakeClientOperationIds.SHUTDOWN_SANDBOXD,
      fn: async () => {
        try {
          let gracefulShutdownError: unknown;
          try {
            await this.#client.runCommand({
              sandboxId: input.id,
              operation: TensorlakeClientOperationIds.SHUTDOWN_SANDBOXD,
              commandDescription: "Gracefully shutdown sandboxd",
              command: "/opt/mistle/bin/sandboxd",
              args: ShutdownCommandArgs,
              ...(input.env === undefined ? {} : { env: { ...input.env } }),
              user: TensorlakeRootProcessUser,
              timeoutMs: SandboxdStopDaemonTimeoutMs,
            });
          } catch (error) {
            gracefulShutdownError = error;
          }

          await this.#client.runCommand({
            sandboxId: input.id,
            operation: TensorlakeClientOperationIds.STOP_SANDBOXD_DAEMON,
            commandDescription: "Stop sandboxd daemon",
            ...createTensorlakeRootShellCommand({ script: SandboxdStopDaemonCommand }),
            user: TensorlakeRootProcessUser,
            timeoutMs: SandboxdStopDaemonTimeoutMs,
          });

          if (gracefulShutdownError !== undefined) {
            reportGracefulShutdownFailure({
              provider: "tensorlake",
              sandboxId: input.id,
              error: gracefulShutdownError,
            });
          }
        } catch (error) {
          if (
            error instanceof TensorlakeClientError &&
            error.code === TensorlakeClientErrorCodes.NOT_FOUND
          ) {
            throw toSandboxNotFoundError(input.id, error);
          }
          throw error;
        }
      },
    });
  }

  async readOperationLog(input: {
    id: string;
    operation: SandboxRuntimeOperationLog;
  }): Promise<string | null> {
    requireSandboxId(input.id);
    const operationLogPath = resolveSandboxdOperationLogPath(input.operation);

    return await withSandboxProviderOperationTelemetry({
      provider: "tensorlake",
      operation: TensorlakeClientOperationIds.READ_OPERATION_LOG,
      fn: async () => {
        try {
          const result = await this.#client.runCommand({
            sandboxId: input.id,
            operation: TensorlakeClientOperationIds.READ_OPERATION_LOG,
            commandDescription: `Read sandbox ${input.operation} operation log`,
            command: "sh",
            args: ["-c", `if test -f '${operationLogPath}'; then cat -- '${operationLogPath}'; fi`],
            timeoutMs: SandboxdReadOperationLogTimeoutMs,
          });
          const logText = result.stdout.trim();
          return logText.length === 0 ? null : logText;
        } catch (error) {
          if (
            error instanceof TensorlakeClientError &&
            error.code === TensorlakeClientErrorCodes.NOT_FOUND
          ) {
            throw toSandboxNotFoundError(input.id, error);
          }
          throw error;
        }
      },
    });
  }

  async close(): Promise<void> {
    this.#client.close();
  }
}

export function createTensorlakeSandboxRuntimeControl(
  client: TensorlakeClient,
): SandboxRuntimeControl {
  if (client === undefined) {
    throw new SandboxProviderNotImplementedError(
      "Tensorlake client is required to construct runtime control.",
    );
  }
  return new TensorlakeSandboxRuntimeControl(client);
}
