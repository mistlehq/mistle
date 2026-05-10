import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import { IntegrationConnectionStatuses } from "@mistle/db/control-plane";
import { BadRequestError, NotFoundError } from "@mistle/http/errors.js";
import { IntegrationKinds, type IntegrationRegistry } from "@mistle/integrations-core";
import {
  E2BSandboxRuntimeCredentialSecretTypes,
  E2BSandboxRuntimeCredentialSlotKeys,
  E2BSandboxRuntimeTargetConfigSchema,
} from "@mistle/integrations-definitions/sandbox-runtimes";
import { SandboxProvider, type SandboxProvider as SandboxProviderValue } from "@mistle/sandbox";

import type { ControlPlaneApiConfig, ControlPlaneApiSandboxRuntimeConfig } from "../../../types.js";
import { resolveIntegrationCredential } from "../../integration-credentials/services/resolve-credential.js";

type ResolveSandboxRuntimeCredentialsContext = {
  db: ControlPlaneDatabase;
  integrationRegistry: IntegrationRegistry;
  integrationsConfig: ControlPlaneApiConfig["integrations"];
  sandboxConfig: ControlPlaneApiSandboxRuntimeConfig;
};

type ResolveSandboxRuntimeCredentialsInput = {
  organizationId: string;
  provider: SandboxProviderValue;
  connectionId?: string;
};

type ResolvedSandboxRuntimeCredentials =
  | {
      provider: typeof SandboxProvider.DOCKER;
      source: "managed";
    }
  | {
      provider: typeof SandboxProvider.E2B;
      source: "managed" | "connection";
      apiKey: string;
      domain?: string;
    };

type SandboxConnection = {
  id: string;
  status: "active" | "error" | "revoked";
  targetKey: string;
};

export async function resolveSandboxRuntimeCredentials(
  ctx: ResolveSandboxRuntimeCredentialsContext,
  input: ResolveSandboxRuntimeCredentialsInput,
): Promise<ResolvedSandboxRuntimeCredentials> {
  if (input.provider === SandboxProvider.DOCKER) {
    if (input.connectionId !== undefined) {
      throw new BadRequestError(
        "INVALID_SANDBOX_CREDENTIAL_REQUEST",
        "Docker sandbox runtime credentials cannot be resolved from an integration connection.",
      );
    }

    if (ctx.sandboxConfig.provider !== SandboxProvider.DOCKER) {
      throw new BadRequestError(
        "MANAGED_SANDBOX_PROVIDER_UNAVAILABLE",
        "Managed Docker sandbox runtime is not configured for this deployment.",
      );
    }

    return {
      provider: SandboxProvider.DOCKER,
      source: "managed",
    };
  }

  if (input.provider === SandboxProvider.E2B) {
    if (input.connectionId === undefined) {
      return resolveManagedE2BCredentials(ctx);
    }

    return resolveConnectionE2BCredentials(ctx, {
      organizationId: input.organizationId,
      provider: SandboxProvider.E2B,
      connectionId: input.connectionId,
    });
  }

  return assertUnreachableSandboxProvider(input.provider);
}

function assertUnreachableSandboxProvider(_provider: never): never {
  throw new BadRequestError("UNSUPPORTED_SANDBOX_PROVIDER", "Sandbox provider is not supported.");
}

function resolveManagedE2BCredentials(
  ctx: ResolveSandboxRuntimeCredentialsContext,
): ResolvedSandboxRuntimeCredentials {
  if (ctx.sandboxConfig.provider !== SandboxProvider.E2B || ctx.sandboxConfig.e2b === undefined) {
    throw new BadRequestError(
      "MANAGED_SANDBOX_PROVIDER_UNAVAILABLE",
      "Managed E2B sandbox runtime is not configured for this deployment.",
    );
  }

  return {
    provider: SandboxProvider.E2B,
    source: "managed",
    apiKey: ctx.sandboxConfig.e2b.apiKey,
    ...(ctx.sandboxConfig.e2b.domain === undefined ? {} : { domain: ctx.sandboxConfig.e2b.domain }),
  };
}

async function resolveConnectionE2BCredentials(
  ctx: ResolveSandboxRuntimeCredentialsContext,
  input: ResolveSandboxRuntimeCredentialsInput & {
    provider: typeof SandboxProvider.E2B;
    connectionId: string;
  },
): Promise<ResolvedSandboxRuntimeCredentials> {
  const connection = await readSandboxConnection(ctx, input);
  const target = await ctx.db.query.integrationTargets.findFirst({
    columns: {
      targetKey: true,
      familyId: true,
      variantId: true,
      enabled: true,
      config: true,
    },
    where: (table, { eq }) => eq(table.targetKey, connection.targetKey),
  });

  if (target === undefined) {
    throw new NotFoundError(
      "SANDBOX_CONNECTION_TARGET_NOT_FOUND",
      `Sandbox connection '${connection.id}' target was not found.`,
    );
  }

  if (!target.enabled) {
    throw new BadRequestError(
      "SANDBOX_CONNECTION_TARGET_DISABLED",
      `Sandbox connection '${connection.id}' target is disabled.`,
    );
  }

  const definition = ctx.integrationRegistry.getDefinition({
    familyId: target.familyId,
    variantId: target.variantId,
  });

  if (definition?.kind !== IntegrationKinds.SANDBOX || definition.sandboxRuntime === undefined) {
    throw new BadRequestError(
      "SANDBOX_CONNECTION_KIND_MISMATCH",
      `Sandbox connection '${connection.id}' does not reference a sandbox integration target.`,
    );
  }

  if (definition.sandboxRuntime.providerId !== SandboxProvider.E2B) {
    throw new BadRequestError(
      "SANDBOX_CONNECTION_PROVIDER_MISMATCH",
      `Sandbox connection '${connection.id}' does not match sandbox provider 'e2b'.`,
    );
  }

  const resolvedCredential = await resolveIntegrationCredential(
    {
      db: ctx.db,
      integrationRegistry: ctx.integrationRegistry,
      integrationsConfig: ctx.integrationsConfig,
    },
    {
      connectionId: connection.id,
      secretType: E2BSandboxRuntimeCredentialSecretTypes.API_KEY,
      slotKey: E2BSandboxRuntimeCredentialSlotKeys.API_KEY,
    },
  );

  if (resolvedCredential.kind !== "value") {
    throw new Error("E2B sandbox runtime API key must resolve to a string credential.");
  }

  const targetConfig = E2BSandboxRuntimeTargetConfigSchema.parse(target.config);

  return {
    provider: SandboxProvider.E2B,
    source: "connection",
    apiKey: resolvedCredential.value,
    ...(targetConfig.domain === undefined ? {} : { domain: targetConfig.domain }),
  };
}

async function readSandboxConnection(
  ctx: ResolveSandboxRuntimeCredentialsContext,
  input: ResolveSandboxRuntimeCredentialsInput & { connectionId: string },
): Promise<SandboxConnection> {
  const connection = await ctx.db.query.integrationConnections.findFirst({
    columns: {
      id: true,
      status: true,
      targetKey: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.id, input.connectionId), eq(table.organizationId, input.organizationId)),
  });

  if (connection === undefined) {
    throw new NotFoundError(
      "SANDBOX_CONNECTION_NOT_FOUND",
      `Sandbox connection '${input.connectionId}' was not found.`,
    );
  }

  if (connection.status !== IntegrationConnectionStatuses.ACTIVE) {
    throw new BadRequestError(
      "SANDBOX_CONNECTION_NOT_ACTIVE",
      `Sandbox connection '${connection.id}' is not active.`,
    );
  }

  return connection;
}
