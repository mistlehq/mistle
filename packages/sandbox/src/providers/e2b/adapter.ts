import { createHash } from "node:crypto";

import type { ConnectionOpts } from "e2b";
import { Sandbox, SandboxNotFoundError, Template } from "e2b";

import {
  SandboxConfigurationError,
  SandboxProviderNotImplementedError,
  SandboxResourceNotFoundError,
} from "../../errors.js";
import {
  SandboxProvider,
  type SandboxAdapter,
  type SandboxDestroyRequest,
  type SandboxHandle,
  type SandboxResumeRequestV1,
  type SandboxStartRequest,
  type SandboxStopRequest,
} from "../../types.js";
import type { E2BSandboxConfig } from "./config.js";

const E2BTemplateAliasPrefix = "mistle-sandbox-base";
const E2BSandboxTemplateCache = new Map<string, Promise<string>>();

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

async function resolveE2BTemplateAlias(input: {
  baseRef: string;
  connectionOptions: ConnectionOpts;
}): Promise<string> {
  const cachedAlias = E2BSandboxTemplateCache.get(input.baseRef);
  if (cachedAlias !== undefined) {
    return cachedAlias;
  }

  const aliasPromise = (async () => {
    const alias = createE2BTemplateAlias(input.baseRef);
    const templateExists = await Template.exists(alias, input.connectionOptions);

    if (!templateExists) {
      const template = Template().fromImage(input.baseRef);
      await Template.build(template, alias, input.connectionOptions);
    }

    return alias;
  })();

  E2BSandboxTemplateCache.set(input.baseRef, aliasPromise);

  try {
    return await aliasPromise;
  } catch (error) {
    E2BSandboxTemplateCache.delete(input.baseRef);
    throw error;
  }
}

function createSandboxHandle(sandboxId: string): SandboxHandle {
  return {
    provider: SandboxProvider.E2B,
    id: sandboxId,
    writeStdin: async () => {
      throw new SandboxProviderNotImplementedError(
        "E2B sandbox stdin is not exposed through @mistle/sandbox.",
      );
    },
    closeStdin: async () => {
      throw new SandboxProviderNotImplementedError(
        "E2B sandbox stdin is not exposed through @mistle/sandbox.",
      );
    },
  };
}

function toSandboxNotFoundError(resourceId: string, error: unknown): SandboxResourceNotFoundError {
  return new SandboxResourceNotFoundError({
    resourceType: "sandbox",
    resourceId,
    cause: error,
  });
}

function requireSandboxId(id: string): void {
  if (id.trim().length === 0) {
    throw new SandboxConfigurationError("Sandbox id is required.");
  }
}

export class E2BSandboxAdapter implements SandboxAdapter {
  readonly #config: E2BSandboxConfig;

  constructor(config: E2BSandboxConfig) {
    this.#config = config;
  }

  async start(request: SandboxStartRequest): Promise<SandboxHandle> {
    if (request.image.provider !== SandboxProvider.E2B) {
      throw new SandboxConfigurationError("E2B adapter received a non-E2B image handle.");
    }

    const connectionOptions = createE2BConnectionOptions(this.#config);
    const templateAlias = await resolveE2BTemplateAlias({
      baseRef: request.image.imageId,
      connectionOptions,
    });
    const sandbox = await Sandbox.create(templateAlias, {
      ...connectionOptions,
      lifecycle: {
        onTimeout: "pause",
      },
      ...(request.env === undefined ? {} : { envs: { ...request.env } }),
    });

    return createSandboxHandle(sandbox.sandboxId);
  }

  async resume(request: SandboxResumeRequestV1): Promise<SandboxHandle> {
    requireSandboxId(request.id);

    try {
      const sandbox = await Sandbox.connect(request.id, createE2BConnectionOptions(this.#config));
      return createSandboxHandle(sandbox.sandboxId);
    } catch (error) {
      if (error instanceof SandboxNotFoundError) {
        throw toSandboxNotFoundError(request.id, error);
      }

      throw error;
    }
  }

  async stop(request: SandboxStopRequest): Promise<void> {
    requireSandboxId(request.id);

    try {
      const sandbox = await Sandbox.connect(request.id, createE2BConnectionOptions(this.#config));
      await sandbox.pause();
    } catch (error) {
      if (error instanceof SandboxNotFoundError) {
        throw toSandboxNotFoundError(request.id, error);
      }

      throw error;
    }
  }

  async destroy(request: SandboxDestroyRequest): Promise<void> {
    requireSandboxId(request.id);

    try {
      const sandbox = await Sandbox.connect(request.id, createE2BConnectionOptions(this.#config));
      await sandbox.kill();
    } catch (error) {
      if (error instanceof SandboxNotFoundError) {
        throw toSandboxNotFoundError(request.id, error);
      }

      throw error;
    }
  }
}

export function createE2BSandboxAdapter(input: { config: E2BSandboxConfig }): SandboxAdapter {
  if (input.config === undefined) {
    throw new SandboxProviderNotImplementedError("E2B config is required to construct adapter.");
  }

  return new E2BSandboxAdapter(input.config);
}
