import { systemSleeper } from "@mistle/time";
import { CommandExitError, Sandbox, type ConnectionOpts } from "e2b";

import { withRequiredSandboxRuntimeEnv } from "../../runtime-env.js";
import {
  E2BClientError,
  E2BClientErrorCodes,
  E2BClientOperationIds,
  mapE2BClientError,
} from "./client-errors.js";
import type { E2BSandboxConfig } from "./config.js";
import {
  E2BApplyStartupRequestSchema,
  E2BDestroySandboxRequestSchema,
  E2BInspectSandboxRequestSchema,
  E2BResumeSandboxRequestSchema,
  E2BStartSandboxRequestSchema,
  E2BStopSandboxRequestSchema,
  type E2BApplyStartupRequest,
  type E2BDestroySandboxRequest,
  type E2BInspectSandboxRequest,
  type E2BResumeSandboxRequest,
  type E2BStartSandboxRequest,
  type E2BStopSandboxRequest,
} from "./schemas.js";
import { E2BApiTemplateRegistry, type E2BTemplateRegistry } from "./template-registry.js";
import type { E2BSandboxInspectResult } from "./types.js";

const ApplyStartupCommand = "/usr/local/bin/sandboxd apply-startup";
const StartSupervisorCommand = "/usr/bin/tini -s -- /usr/local/bin/sandboxd serve";
const SupervisorSocketPath = "/run/mistle/startup-config.sock";
const SupervisorTokenPath = "/run/mistle/startup-config.token";
const SupervisorReadinessPollIntervalMs = 100;
const SupervisorReadinessPollAttempts = 100;
const E2BTemplateAliasMetadataKey = "mistle_template_alias";

export type E2BStartSandboxResponse = {
  sandboxId: string;
};

export interface E2BClient {
  startSandbox(request: E2BStartSandboxRequest): Promise<E2BStartSandboxResponse>;
  inspectSandbox(request: E2BInspectSandboxRequest): Promise<E2BSandboxInspectResult>;
  resumeSandbox(request: E2BResumeSandboxRequest): Promise<E2BStartSandboxResponse>;
  stopSandbox(request: E2BStopSandboxRequest): Promise<void>;
  destroySandbox(request: E2BDestroySandboxRequest): Promise<void>;
  applyStartup(request: E2BApplyStartupRequest): Promise<void>;
}

function createE2BConnectionOptions(config: E2BSandboxConfig): ConnectionOpts {
  return {
    apiKey: config.apiKey,
    ...(config.domain === undefined ? {} : { domain: config.domain }),
  };
}

function formatCommandOutput(input: { stdout: string; stderr: string }): string {
  const outputs: string[] = [];

  const trimmedStdout = input.stdout.trim();
  if (trimmedStdout.length > 0) {
    outputs.push(`stdout: ${trimmedStdout}`);
  }

  const trimmedStderr = input.stderr.trim();
  if (trimmedStderr.length > 0) {
    outputs.push(`stderr: ${trimmedStderr}`);
  }

  return outputs.length === 0 ? "" : ` ${outputs.join(" ")}`;
}

function createCommandExitError(input: {
  operation: (typeof E2BClientOperationIds)[keyof typeof E2BClientOperationIds];
  error: CommandExitError;
  commandDescription?: string;
}): E2BClientError {
  return new E2BClientError({
    code: E2BClientErrorCodes.COMMAND_EXIT,
    operation: input.operation,
    retryable: false,
    message: `E2B operation \`${input.operation}\` failed: ${input.commandDescription ?? "E2B command"} exited with code ${String(input.error.exitCode)}.${formatCommandOutput(
      {
        stdout: input.error.stdout,
        stderr: input.error.stderr,
      },
    )}`,
    cause: input.error,
  });
}

function createUnknownClientError(input: {
  operation: (typeof E2BClientOperationIds)[keyof typeof E2BClientOperationIds];
  message: string;
  cause: unknown;
}): E2BClientError {
  return new E2BClientError({
    code: E2BClientErrorCodes.UNKNOWN,
    operation: input.operation,
    retryable: false,
    message: `E2B operation \`${input.operation}\` failed: ${input.message}`,
    cause: input.cause,
  });
}

async function sleep(ms: number): Promise<void> {
  await systemSleeper.sleep(ms);
}

export class E2BApiClient implements E2BClient {
  readonly #connectionOptions: ConnectionOpts;
  readonly #templateRegistry: E2BTemplateRegistry;

  constructor(input: { config: E2BSandboxConfig; templateRegistry?: E2BTemplateRegistry }) {
    this.#connectionOptions = createE2BConnectionOptions(input.config);
    this.#templateRegistry =
      input.templateRegistry ?? new E2BApiTemplateRegistry(this.#connectionOptions);
  }

  async startSandbox(request: E2BStartSandboxRequest): Promise<E2BStartSandboxResponse> {
    const parsedRequest = E2BStartSandboxRequestSchema.parse(request);
    const templateAlias = await this.#templateRegistry.resolveAlias(parsedRequest.imageRef);

    try {
      const sandbox = await Sandbox.create(templateAlias, {
        ...this.#connectionOptions,
        lifecycle: {
          onTimeout: "pause",
        },
        metadata: {
          [E2BTemplateAliasMetadataKey]: templateAlias,
        },
        envs: withRequiredSandboxRuntimeEnv(parsedRequest.env),
      });

      return {
        sandboxId: sandbox.sandboxId,
      };
    } catch (error) {
      throw mapE2BClientError(E2BClientOperationIds.CREATE_SANDBOX, error);
    }
  }

  async inspectSandbox(request: E2BInspectSandboxRequest): Promise<E2BSandboxInspectResult> {
    const parsedRequest = E2BInspectSandboxRequestSchema.parse(request);

    try {
      const sandbox = await Sandbox.getInfo(parsedRequest.sandboxId, this.#connectionOptions);

      return {
        provider: "e2b",
        id: sandbox.sandboxId,
        state: sandbox.state,
        createdAt: sandbox.startedAt.toISOString(),
        startedAt: sandbox.startedAt.toISOString(),
        endedAt: sandbox.endAt.toISOString(),
        providerInfo: {
          templateId: sandbox.templateId,
          templateAlias: this.#getTemplateAliasFromMetadata(sandbox.metadata),
          name: sandbox.name ?? null,
          metadata: sandbox.metadata,
          cpuCount: sandbox.cpuCount,
          memoryMB: sandbox.memoryMB,
        },
      };
    } catch (error) {
      throw mapE2BClientError(E2BClientOperationIds.GET_SANDBOX_INFO, error);
    }
  }

  async resumeSandbox(request: E2BResumeSandboxRequest): Promise<E2BStartSandboxResponse> {
    const parsedRequest = E2BResumeSandboxRequestSchema.parse(request);

    try {
      const sandbox = await Sandbox.connect(parsedRequest.sandboxId, this.#connectionOptions);
      return {
        sandboxId: sandbox.sandboxId,
      };
    } catch (error) {
      throw mapE2BClientError(E2BClientOperationIds.CONNECT_SANDBOX, error);
    }
  }

  async stopSandbox(request: E2BStopSandboxRequest): Promise<void> {
    const parsedRequest = E2BStopSandboxRequestSchema.parse(request);

    try {
      const sandbox = await Sandbox.connect(parsedRequest.sandboxId, this.#connectionOptions);
      await sandbox.pause();
    } catch (error) {
      throw mapE2BClientError(E2BClientOperationIds.PAUSE_SANDBOX, error);
    }
  }

  async destroySandbox(request: E2BDestroySandboxRequest): Promise<void> {
    const parsedRequest = E2BDestroySandboxRequestSchema.parse(request);

    try {
      const sandbox = await Sandbox.connect(parsedRequest.sandboxId, this.#connectionOptions);
      await sandbox.kill();
    } catch (error) {
      throw mapE2BClientError(E2BClientOperationIds.KILL_SANDBOX, error);
    }
  }

  async applyStartup(request: E2BApplyStartupRequest): Promise<void> {
    const parsedRequest = E2BApplyStartupRequestSchema.parse(request);

    try {
      const sandbox = await Sandbox.connect(parsedRequest.sandboxId, this.#connectionOptions);
      await this.#ensureSupervisorReady(sandbox);
      const handle = await sandbox.commands.run(ApplyStartupCommand, {
        background: true,
        stdin: true,
        user: "root",
      });

      await sandbox.commands.sendStdin(handle.pid, parsedRequest.payload);
      await sandbox.commands.closeStdin(handle.pid);
      await handle.wait();
    } catch (error) {
      if (error instanceof CommandExitError) {
        throw createCommandExitError({
          operation: E2BClientOperationIds.APPLY_STARTUP,
          error,
          commandDescription: "E2B startup apply command",
        });
      }

      throw mapE2BClientError(E2BClientOperationIds.APPLY_STARTUP, error);
    }
  }

  async #ensureSupervisorReady(sandbox: Sandbox): Promise<void> {
    if (await this.#isSupervisorReady(sandbox)) {
      return;
    }

    try {
      const handle = await sandbox.commands.run(StartSupervisorCommand, {
        background: true,
        user: "root",
      });
      const exitPromise = handle
        .wait()
        .then(() => {
          throw createUnknownClientError({
            operation: E2BClientOperationIds.ENSURE_SUPERVISOR_READY,
            message: "sandbox supervisor exited before becoming ready",
            cause: new Error("sandbox supervisor exited before becoming ready"),
          });
        })
        .catch((error: unknown) => {
          if (error instanceof CommandExitError) {
            throw createCommandExitError({
              operation: E2BClientOperationIds.ENSURE_SUPERVISOR_READY,
              error,
              commandDescription: "E2B sandbox supervisor command",
            });
          }

          throw mapE2BClientError(E2BClientOperationIds.ENSURE_SUPERVISOR_READY, error);
        });
      void exitPromise.catch(() => undefined);

      try {
        for (let attempt = 0; attempt < SupervisorReadinessPollAttempts; attempt += 1) {
          const readinessResult = await Promise.race([
            this.#checkSupervisorReady(sandbox),
            exitPromise,
          ]);

          if (readinessResult) {
            return;
          }

          await sleep(SupervisorReadinessPollIntervalMs);
        }
      } finally {
        await handle.disconnect().catch(() => undefined);
      }
    } catch (error) {
      if (error instanceof E2BClientError) {
        throw error;
      }

      throw mapE2BClientError(E2BClientOperationIds.ENSURE_SUPERVISOR_READY, error);
    }

    throw createUnknownClientError({
      operation: E2BClientOperationIds.ENSURE_SUPERVISOR_READY,
      message: `sandbox supervisor did not become ready within ${String(SupervisorReadinessPollIntervalMs * SupervisorReadinessPollAttempts)}ms`,
      cause: new Error("sandbox supervisor readiness timed out"),
    });
  }

  async #isSupervisorReady(sandbox: Sandbox): Promise<boolean> {
    try {
      return await this.#checkSupervisorReady(sandbox);
    } catch (error) {
      throw mapE2BClientError(E2BClientOperationIds.ENSURE_SUPERVISOR_READY, error);
    }
  }

  #getTemplateAliasFromMetadata(metadata: Readonly<Record<string, string>>): string {
    const templateAlias = metadata[E2BTemplateAliasMetadataKey];
    if (templateAlias === undefined || templateAlias.length === 0) {
      throw new E2BClientError({
        code: E2BClientErrorCodes.TEMPLATE_ERROR,
        operation: E2BClientOperationIds.GET_SANDBOX_INFO,
        retryable: false,
        message: `E2B operation \`${E2BClientOperationIds.GET_SANDBOX_INFO}\` failed: sandbox metadata is missing the stable template alias.`,
        cause: metadata,
      });
    }

    return templateAlias;
  }

  async #checkSupervisorReady(sandbox: Sandbox): Promise<boolean> {
    const result = await sandbox.commands.run(
      `if test -S '${SupervisorSocketPath}' && test -f '${SupervisorTokenPath}'; then printf ready; else printf not-ready; fi`,
      {
        user: "root",
      },
    );

    return result.stdout.trim() === "ready";
  }
}
