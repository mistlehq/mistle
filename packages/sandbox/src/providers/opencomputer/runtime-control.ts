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
  OpenComputerClientError,
  OpenComputerClientErrorCodes,
  OpenComputerClientOperationIds,
} from "./client-errors.js";
import {
  createOpenComputerRootShellCommand,
  createOpenComputerSandboxdCommand,
  type OpenComputerClient,
} from "./client.js";

export { SandboxdOperationLogPaths };

const SandboxdEnsureTimeoutMs = 120_000;
export const OpenComputerSandboxdActivateTimeoutMs = 60 * 60 * 1000;
export const OpenComputerSandboxdStopDaemonTimeoutMs = 30_000;
export const OpenComputerSandboxdResetTransparentEgressNftablesTimeoutMs = 10_000;
export const OpenComputerSandboxdReadOperationLogTimeoutMs = 60_000;

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

function isOpenComputerNotFound(error: unknown): boolean {
  return (
    error instanceof OpenComputerClientError &&
    error.code === OpenComputerClientErrorCodes.NOT_FOUND
  );
}

function reportGracefulShutdownFailure(input: { sandboxId: string; error: unknown }): void {
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  process.stderr.write(
    `Mistle OpenComputer sandbox '${input.sandboxId}' graceful sandboxd shutdown failed before hard daemon stop: ${message}\n`,
  );
}

export class OpenComputerSandboxRuntimeControl implements SandboxRuntimeControl {
  readonly #client: OpenComputerClient;

  constructor(client: OpenComputerClient) {
    this.#client = client;
  }

  async readSandboxdVersion(input: {
    id: string;
    env?: Readonly<Record<string, string>>;
  }): Promise<string> {
    requireSandboxId(input.id);

    return await withSandboxProviderOperationTelemetry({
      provider: "opencomputer",
      operation: OpenComputerClientOperationIds.READ_SANDBOXD_VERSION,
      fn: async () => {
        try {
          const command = createOpenComputerSandboxdCommand({
            args: ["version"],
            env: input.env,
          });
          const result = await this.#client.runCommand({
            sandboxId: input.id,
            operation: OpenComputerClientOperationIds.READ_SANDBOXD_VERSION,
            commandDescription: "Read sandboxd version",
            command: command.command,
            args: command.args,
          });
          const version = result.stdout.trim();
          if (version.length === 0) {
            throw new Error("OpenComputer sandboxd version command returned empty stdout.");
          }
          return version;
        } catch (error) {
          if (isOpenComputerNotFound(error)) {
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
      provider: "opencomputer",
      operation: OpenComputerClientOperationIds.ENSURE_SANDBOXD,
      fn: async () => {
        try {
          await this.#client.runCommand({
            sandboxId: input.id,
            operation: OpenComputerClientOperationIds.STOP_SANDBOXD_DAEMON,
            commandDescription: "Stop sandboxd daemon",
            ...createOpenComputerRootShellCommand({ script: SandboxdStopDaemonCommand }),
            timeoutMs: OpenComputerSandboxdStopDaemonTimeoutMs,
          });
          await this.#client.runCommand({
            sandboxId: input.id,
            operation: OpenComputerClientOperationIds.RESET_TRANSPARENT_EGRESS_NFTABLES,
            commandDescription: "Reset transparent egress nftables",
            ...createOpenComputerRootShellCommand({
              script: SandboxdResetTransparentEgressNftablesCommand,
            }),
            timeoutMs: OpenComputerSandboxdResetTransparentEgressNftablesTimeoutMs,
          });
          await this.#client.runCommand({
            sandboxId: input.id,
            operation: OpenComputerClientOperationIds.ENSURE_SANDBOXD,
            commandDescription: "Ensure sandboxd artifact",
            ...createOpenComputerRootShellCommand({
              script: SandboxdInstallCommand,
              env: {
                [SandboxdInstallEnvVars.URL]: input.artifact.url,
                [SandboxdInstallEnvVars.SHA256]: input.artifact.sha256,
                [SandboxdInstallEnvVars.VERSION]: input.artifact.version,
              },
            }),
            timeoutMs: SandboxdEnsureTimeoutMs,
          });
        } catch (error) {
          if (isOpenComputerNotFound(error)) {
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
      provider: "opencomputer",
      operation: OpenComputerClientOperationIds.ACTIVATE,
      fn: async () => {
        try {
          await this.#client.activate({
            sandboxId: input.id,
            payload: input.payload,
            ...(input.env === undefined ? {} : { env: input.env }),
            timeoutMs: OpenComputerSandboxdActivateTimeoutMs,
          });
        } catch (error) {
          if (isOpenComputerNotFound(error)) {
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
      provider: "opencomputer",
      operation: OpenComputerClientOperationIds.SHUTDOWN_SANDBOXD,
      fn: async () => {
        try {
          let gracefulShutdownError: unknown;
          try {
            await this.#client.runCommand({
              sandboxId: input.id,
              operation: OpenComputerClientOperationIds.SHUTDOWN_SANDBOXD,
              commandDescription: "Gracefully shutdown sandboxd",
              ...createOpenComputerSandboxdCommand({
                args: ["shutdown"],
                env: input.env,
              }),
              timeoutMs: OpenComputerSandboxdStopDaemonTimeoutMs,
            });
          } catch (error) {
            gracefulShutdownError = error;
          }

          await this.#client.runCommand({
            sandboxId: input.id,
            operation: OpenComputerClientOperationIds.STOP_SANDBOXD_DAEMON,
            commandDescription: "Stop sandboxd daemon",
            ...createOpenComputerRootShellCommand({ script: SandboxdStopDaemonCommand }),
            timeoutMs: OpenComputerSandboxdStopDaemonTimeoutMs,
          });

          if (gracefulShutdownError !== undefined) {
            reportGracefulShutdownFailure({
              sandboxId: input.id,
              error: gracefulShutdownError,
            });
          }
        } catch (error) {
          if (isOpenComputerNotFound(error)) {
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
      provider: "opencomputer",
      operation: OpenComputerClientOperationIds.READ_OPERATION_LOG,
      fn: async () => {
        try {
          const command = createOpenComputerRootShellCommand({
            script: `[ -f ${shellQuote(operationLogPath)} ] && cat ${shellQuote(operationLogPath)} || true`,
          });
          const result = await this.#client.runCommand({
            sandboxId: input.id,
            operation: OpenComputerClientOperationIds.READ_OPERATION_LOG,
            commandDescription: `Read sandboxd ${input.operation} operation log`,
            command: command.command,
            args: command.args,
            timeoutMs: OpenComputerSandboxdReadOperationLogTimeoutMs,
          });
          return result.stdout.length === 0 ? null : result.stdout;
        } catch (error) {
          if (isOpenComputerNotFound(error)) {
            throw toSandboxNotFoundError(input.id, error);
          }
          throw error;
        }
      },
    });
  }

  async close(): Promise<void> {
    await this.#client.close();
  }
}

export function createOpenComputerSandboxRuntimeControl(
  client: OpenComputerClient,
): OpenComputerSandboxRuntimeControl {
  if (client === undefined) {
    throw new SandboxProviderNotImplementedError(
      "OpenComputer client is required to construct runtime control.",
    );
  }
  return new OpenComputerSandboxRuntimeControl(client);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}
