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
  FreestyleClientError,
  FreestyleClientErrorCodes,
  FreestyleClientOperationIds,
} from "./client-errors.js";
import type { FreestyleClient } from "./client.js";

export { SandboxdOperationLogPaths };

const SandboxdEnsureTimeoutMs = 120_000;
export const FreestyleSandboxdActivateTimeoutMs = 60 * 60 * 1000;
export const FreestyleSandboxdStopDaemonTimeoutMs = 30_000;
export const FreestyleSandboxdResetTransparentEgressNftablesTimeoutMs = 10_000;
export const FreestyleSandboxdReadOperationLogTimeoutMs = 60_000;

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

function isFreestyleNotFound(error: unknown): boolean {
  return (
    error instanceof FreestyleClientError && error.code === FreestyleClientErrorCodes.NOT_FOUND
  );
}

function reportGracefulShutdownFailure(input: { sandboxId: string; error: unknown }): void {
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  process.stderr.write(
    `Mistle freestyle sandbox '${input.sandboxId}' graceful sandboxd shutdown failed before hard daemon stop: ${message}\n`,
  );
}

export class FreestyleSandboxRuntimeControl implements SandboxRuntimeControl {
  readonly #client: FreestyleClient;

  constructor(client: FreestyleClient) {
    this.#client = client;
  }

  async readSandboxdVersion(input: {
    id: string;
    env?: Readonly<Record<string, string>>;
  }): Promise<string> {
    requireSandboxId(input.id);

    return await withSandboxProviderOperationTelemetry({
      provider: "freestyle",
      operation: FreestyleClientOperationIds.READ_SANDBOXD_VERSION,
      fn: async () => {
        try {
          const result = await this.#client.runCommand({
            vmId: input.id,
            operation: FreestyleClientOperationIds.READ_SANDBOXD_VERSION,
            commandDescription: "Read sandboxd version",
            command: "/opt/mistle/bin/sandboxd version",
            ...(input.env === undefined ? {} : { env: input.env }),
          });
          const version = result.stdout.trim();
          if (version.length === 0) {
            throw new Error("Freestyle sandboxd version command returned empty stdout.");
          }
          return version;
        } catch (error) {
          if (isFreestyleNotFound(error)) {
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
      provider: "freestyle",
      operation: FreestyleClientOperationIds.ENSURE_SANDBOXD,
      fn: async () => {
        try {
          await this.#client.runCommand({
            vmId: input.id,
            operation: FreestyleClientOperationIds.STOP_SANDBOXD_DAEMON,
            commandDescription: "Stop sandboxd daemon",
            command: SandboxdStopDaemonCommand,
            timeoutMs: FreestyleSandboxdStopDaemonTimeoutMs,
          });
          await this.#client.runCommand({
            vmId: input.id,
            operation: FreestyleClientOperationIds.RESET_TRANSPARENT_EGRESS_NFTABLES,
            commandDescription: "Reset transparent egress nftables",
            command: SandboxdResetTransparentEgressNftablesCommand,
            timeoutMs: FreestyleSandboxdResetTransparentEgressNftablesTimeoutMs,
          });
          await this.#client.runCommand({
            vmId: input.id,
            operation: FreestyleClientOperationIds.ENSURE_SANDBOXD,
            commandDescription: "Ensure sandboxd artifact",
            command: SandboxdInstallCommand,
            env: {
              [SandboxdInstallEnvVars.URL]: input.artifact.url,
              [SandboxdInstallEnvVars.SHA256]: input.artifact.sha256,
              [SandboxdInstallEnvVars.VERSION]: input.artifact.version,
            },
            timeoutMs: SandboxdEnsureTimeoutMs,
          });
        } catch (error) {
          if (isFreestyleNotFound(error)) {
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
      provider: "freestyle",
      operation: FreestyleClientOperationIds.ACTIVATE,
      fn: async () => {
        try {
          await this.#client.activate({
            vmId: input.id,
            payload: input.payload,
            ...(input.env === undefined ? {} : { env: input.env }),
            timeoutMs: FreestyleSandboxdActivateTimeoutMs,
          });
        } catch (error) {
          if (isFreestyleNotFound(error)) {
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
      provider: "freestyle",
      operation: FreestyleClientOperationIds.SHUTDOWN_SANDBOXD,
      fn: async () => {
        try {
          let gracefulShutdownError: unknown;
          try {
            await this.#client.runCommand({
              vmId: input.id,
              operation: FreestyleClientOperationIds.SHUTDOWN_SANDBOXD,
              commandDescription: "Gracefully shutdown sandboxd",
              command: "/opt/mistle/bin/sandboxd shutdown",
              ...(input.env === undefined ? {} : { env: input.env }),
              timeoutMs: FreestyleSandboxdStopDaemonTimeoutMs,
            });
          } catch (error) {
            gracefulShutdownError = error;
          }

          if (gracefulShutdownError !== undefined) {
            reportGracefulShutdownFailure({
              sandboxId: input.id,
              error: gracefulShutdownError,
            });
          }

          await this.#client.runCommand({
            vmId: input.id,
            operation: FreestyleClientOperationIds.STOP_SANDBOXD_DAEMON,
            commandDescription: "Stop sandboxd daemon",
            command: SandboxdStopDaemonCommand,
            timeoutMs: FreestyleSandboxdStopDaemonTimeoutMs,
          });
        } catch (error) {
          if (isFreestyleNotFound(error)) {
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

    return await withSandboxProviderOperationTelemetry({
      provider: "freestyle",
      operation: FreestyleClientOperationIds.READ_OPERATION_LOG,
      fn: async () => {
        const path = resolveSandboxdOperationLogPath(input.operation);
        try {
          const result = await this.#client.runCommand({
            vmId: input.id,
            operation: FreestyleClientOperationIds.READ_OPERATION_LOG,
            commandDescription: `Read sandboxd ${input.operation} operation log`,
            command: `[ -f ${shellQuote(path)} ] && cat ${shellQuote(path)} || true`,
            timeoutMs: FreestyleSandboxdReadOperationLogTimeoutMs,
          });
          const output = result.stdout;
          return output.length === 0 ? null : output;
        } catch (error) {
          if (isFreestyleNotFound(error)) {
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

export function createFreestyleSandboxRuntimeControl(input: {
  client: FreestyleClient;
}): FreestyleSandboxRuntimeControl {
  if (input.client === undefined) {
    throw new SandboxProviderNotImplementedError(
      "Freestyle client is required to construct runtime control.",
    );
  }
  return new FreestyleSandboxRuntimeControl(input.client);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}
