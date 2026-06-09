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
import { ModalClientOperationIds } from "./client-errors.js";
import { isModalNotFound, type ModalClientApi } from "./client.js";

export { SandboxdOperationLogPaths };

const SandboxdEnsureTimeoutMs = 120_000;
export const ModalSandboxdActivateTimeoutMs = 60 * 60 * 1000;
export const ModalSandboxdStopDaemonTimeoutMs = 30_000;
export const ModalSandboxdResetTransparentEgressNftablesTimeoutMs = 10_000;
export const ModalSandboxdReadOperationLogTimeoutMs = 60_000;

const ModalEnsureRuntimeDirectoriesCommand = `
set -eu
mkdir -p /run/mistle /var/lib/mistle/artifacts
chmod 0700 /run/mistle
`.trim();

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

function reportGracefulShutdownFailure(input: { sandboxId: string; error: unknown }): void {
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  process.stderr.write(
    `Mistle modal sandbox '${input.sandboxId}' graceful sandboxd shutdown failed before hard daemon stop: ${message}\n`,
  );
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

export class ModalSandboxRuntimeControl implements SandboxRuntimeControl {
  readonly #client: ModalClientApi;

  constructor(client: ModalClientApi) {
    this.#client = client;
  }

  async readSandboxdVersion(input: {
    id: string;
    env?: Readonly<Record<string, string>>;
  }): Promise<string> {
    requireSandboxId(input.id);

    return await withSandboxProviderOperationTelemetry({
      provider: "modal",
      operation: ModalClientOperationIds.READ_SANDBOXD_VERSION,
      fn: async () => {
        try {
          const result = await this.#client.runCommand({
            sandboxId: input.id,
            operation: ModalClientOperationIds.READ_SANDBOXD_VERSION,
            commandDescription: "Read sandboxd version",
            command: "/opt/mistle/bin/sandboxd",
            args: ["version"],
            ...(input.env === undefined ? {} : { env: { ...input.env } }),
          });
          const version = result.stdout.trim();
          if (version.length === 0) {
            throw new Error("Modal sandboxd version command returned empty stdout.");
          }
          return version;
        } catch (error) {
          if (isModalNotFound(error)) {
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
      provider: "modal",
      operation: ModalClientOperationIds.ENSURE_SANDBOXD,
      fn: async () => {
        try {
          await this.#client.runCommand({
            sandboxId: input.id,
            operation: ModalClientOperationIds.ENSURE_SANDBOXD,
            commandDescription: "Ensure Modal runtime directories",
            command: ModalEnsureRuntimeDirectoriesCommand,
            timeoutMs: SandboxdEnsureTimeoutMs,
          });
          await this.#client.runCommand({
            sandboxId: input.id,
            operation: ModalClientOperationIds.STOP_SANDBOXD_DAEMON,
            commandDescription: "Stop sandboxd daemon",
            command: SandboxdStopDaemonCommand,
            timeoutMs: ModalSandboxdStopDaemonTimeoutMs,
          });
          await this.#client.runCommand({
            sandboxId: input.id,
            operation: ModalClientOperationIds.RESET_TRANSPARENT_EGRESS_NFTABLES,
            commandDescription: "Reset transparent egress nftables",
            command: SandboxdResetTransparentEgressNftablesCommand,
            timeoutMs: ModalSandboxdResetTransparentEgressNftablesTimeoutMs,
          });
          await this.#client.runCommand({
            sandboxId: input.id,
            operation: ModalClientOperationIds.ENSURE_SANDBOXD,
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
          if (isModalNotFound(error)) {
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
      provider: "modal",
      operation: ModalClientOperationIds.ACTIVATE,
      fn: async () => {
        try {
          await this.#client.activate({
            sandboxId: input.id,
            payload: input.payload,
            ...(input.env === undefined ? {} : { env: input.env }),
            timeoutMs: ModalSandboxdActivateTimeoutMs,
          });
        } catch (error) {
          if (isModalNotFound(error)) {
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
      provider: "modal",
      operation: ModalClientOperationIds.SHUTDOWN_SANDBOXD,
      fn: async () => {
        try {
          let gracefulShutdownError: unknown;
          try {
            await this.#client.runCommand({
              sandboxId: input.id,
              operation: ModalClientOperationIds.SHUTDOWN_SANDBOXD,
              commandDescription: "Gracefully shutdown sandboxd",
              command: "/opt/mistle/bin/sandboxd",
              args: ["shutdown"],
              ...(input.env === undefined ? {} : { env: { ...input.env } }),
              timeoutMs: ModalSandboxdStopDaemonTimeoutMs,
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
            sandboxId: input.id,
            operation: ModalClientOperationIds.STOP_SANDBOXD_DAEMON,
            commandDescription: "Stop sandboxd daemon",
            command: SandboxdStopDaemonCommand,
            timeoutMs: ModalSandboxdStopDaemonTimeoutMs,
          });
        } catch (error) {
          if (isModalNotFound(error)) {
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
      provider: "modal",
      operation: ModalClientOperationIds.READ_OPERATION_LOG,
      fn: async () => {
        const path = resolveSandboxdOperationLogPath(input.operation);
        try {
          const result = await this.#client.runCommand({
            sandboxId: input.id,
            operation: ModalClientOperationIds.READ_OPERATION_LOG,
            commandDescription: `Read sandboxd ${input.operation} operation log`,
            command: `[ -f ${shellQuote(path)} ] && cat ${shellQuote(path)} || true`,
            timeoutMs: ModalSandboxdReadOperationLogTimeoutMs,
          });
          const output = result.stdout;
          return output.length === 0 ? null : output;
        } catch (error) {
          if (isModalNotFound(error)) {
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

export function createModalSandboxRuntimeControl(input: {
  client: ModalClientApi;
}): ModalSandboxRuntimeControl {
  if (input.client === undefined) {
    throw new SandboxProviderNotImplementedError(
      "Modal client is required to construct runtime control.",
    );
  }
  return new ModalSandboxRuntimeControl(input.client);
}
