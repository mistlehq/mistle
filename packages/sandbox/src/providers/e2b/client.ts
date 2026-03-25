import { createHash } from "node:crypto";

import { CommandExitError, Sandbox, Template, type ConnectionOpts } from "e2b";

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
  E2BResumeSandboxRequestSchema,
  E2BStartSandboxRequestSchema,
  E2BStopSandboxRequestSchema,
  type E2BApplyStartupRequest,
  type E2BDestroySandboxRequest,
  type E2BResumeSandboxRequest,
  type E2BStartSandboxRequest,
  type E2BStopSandboxRequest,
} from "./schemas.js";

const ApplyStartupCommand = "/usr/local/bin/sandboxd apply-startup";
const E2BTemplateAliasPrefix = "mistle-sandbox-base";
const E2BSandboxTemplateCache = new Map<string, Promise<string>>();

export type E2BStartSandboxResponse = {
  sandboxId: string;
};

export interface E2BClient {
  startSandbox(request: E2BStartSandboxRequest): Promise<E2BStartSandboxResponse>;
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

function createE2BTemplateAlias(baseRef: string): string {
  const hash = createHash("sha256").update(baseRef).digest("hex");
  return `${E2BTemplateAliasPrefix}-${hash.slice(0, 24)}`;
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
}): E2BClientError {
  return new E2BClientError({
    code: E2BClientErrorCodes.COMMAND_EXIT,
    operation: input.operation,
    retryable: false,
    message: `E2B operation \`${input.operation}\` failed: E2B startup apply command exited with code ${String(input.error.exitCode)}.${formatCommandOutput(
      {
        stdout: input.error.stdout,
        stderr: input.error.stderr,
      },
    )}`,
    cause: input.error,
  });
}

export class E2BApiClient implements E2BClient {
  readonly #connectionOptions: ConnectionOpts;

  constructor(config: E2BSandboxConfig) {
    this.#connectionOptions = createE2BConnectionOptions(config);
  }

  async startSandbox(request: E2BStartSandboxRequest): Promise<E2BStartSandboxResponse> {
    const parsedRequest = E2BStartSandboxRequestSchema.parse(request);
    const templateAlias = await this.#resolveTemplateAlias(parsedRequest.imageRef);

    try {
      const sandbox = await Sandbox.create(templateAlias, {
        ...this.#connectionOptions,
        lifecycle: {
          onTimeout: "pause",
        },
        ...(parsedRequest.env === undefined ? {} : { envs: { ...parsedRequest.env } }),
      });

      return {
        sandboxId: sandbox.sandboxId,
      };
    } catch (error) {
      throw mapE2BClientError(E2BClientOperationIds.CREATE_SANDBOX, error);
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
        });
      }

      throw mapE2BClientError(E2BClientOperationIds.APPLY_STARTUP, error);
    }
  }

  async #resolveTemplateAlias(baseRef: string): Promise<string> {
    const cachedAlias = E2BSandboxTemplateCache.get(baseRef);
    if (cachedAlias !== undefined) {
      return cachedAlias;
    }

    const aliasPromise = (async () => {
      try {
        const alias = createE2BTemplateAlias(baseRef);
        const templateExists = await Template.exists(alias, this.#connectionOptions);

        if (!templateExists) {
          const template = Template().fromImage(baseRef);
          await Template.build(template, alias, this.#connectionOptions);
        }

        return alias;
      } catch (error) {
        throw mapE2BClientError(E2BClientOperationIds.RESOLVE_TEMPLATE_ALIAS, error);
      }
    })();

    E2BSandboxTemplateCache.set(baseRef, aliasPromise);

    try {
      return await aliasPromise;
    } catch (error) {
      E2BSandboxTemplateCache.delete(baseRef);
      throw error;
    }
  }
}
