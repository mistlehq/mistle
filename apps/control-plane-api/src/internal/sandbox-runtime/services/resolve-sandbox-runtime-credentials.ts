import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import { IntegrationConnectionStatuses } from "@mistle/db/control-plane";
import { BadRequestError, NotFoundError } from "@mistle/http/errors.js";
import { IntegrationKinds, type IntegrationRegistry } from "@mistle/integrations-core";
import {
  E2BSandboxRuntimeCredentialSecretTypes,
  E2BSandboxRuntimeCredentialSlotKeys,
  E2BSandboxRuntimeTargetConfigSchema,
  FreestyleSandboxRuntimeCredentialSecretTypes,
  FreestyleSandboxRuntimeCredentialSlotKeys,
  FreestyleSandboxRuntimeTargetConfigSchema,
  ModalSandboxRuntimeCredentialSecretTypes,
  ModalSandboxRuntimeCredentialSlotKeys,
  ModalSandboxRuntimeDefaultAppName,
  OpenComputerSandboxRuntimeCredentialSecretTypes,
  OpenComputerSandboxRuntimeCredentialSlotKeys,
  OpenComputerSandboxRuntimeTargetConfigSchema,
  TensorlakeSandboxRuntimeCredentialSecretTypes,
  TensorlakeSandboxRuntimeCredentialSlotKeys,
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
    }
  | {
      provider: typeof SandboxProvider.TENSORLAKE;
      source: "managed" | "connection";
      apiKey: string;
    }
  | {
      provider: typeof SandboxProvider.OPENCOMPUTER;
      source: "managed" | "connection";
      apiKey: string;
      apiBaseUrl?: string;
    }
  | {
      provider: typeof SandboxProvider.FREESTYLE;
      source: "managed" | "connection";
      apiKey: string;
      baseUrl?: string;
    }
  | {
      provider: typeof SandboxProvider.MODAL;
      source: "managed" | "connection";
      tokenId: string;
      tokenSecret: string;
      appName: string;
      environment?: string;
      defaultTimeoutMs?: number;
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

    if (ctx.sandboxConfig.docker?.enabled !== true) {
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

  if (input.provider === SandboxProvider.TENSORLAKE) {
    if (input.connectionId === undefined) {
      return resolveManagedTensorlakeCredentials(ctx);
    }

    return resolveConnectionTensorlakeCredentials(ctx, {
      organizationId: input.organizationId,
      provider: SandboxProvider.TENSORLAKE,
      connectionId: input.connectionId,
    });
  }

  if (input.provider === SandboxProvider.MODAL) {
    if (input.connectionId === undefined) {
      return resolveManagedModalCredentials(ctx);
    }

    return resolveConnectionModalCredentials(ctx, {
      organizationId: input.organizationId,
      provider: SandboxProvider.MODAL,
      connectionId: input.connectionId,
    });
  }

  if (input.provider === SandboxProvider.OPENCOMPUTER) {
    if (input.connectionId === undefined) {
      return resolveManagedOpenComputerCredentials(ctx);
    }

    return resolveConnectionOpenComputerCredentials(ctx, {
      organizationId: input.organizationId,
      provider: SandboxProvider.OPENCOMPUTER,
      connectionId: input.connectionId,
    });
  }

  if (input.provider === SandboxProvider.FREESTYLE) {
    if (input.connectionId === undefined) {
      return resolveManagedFreestyleCredentials(ctx);
    }

    return resolveConnectionFreestyleCredentials(ctx, {
      organizationId: input.organizationId,
      provider: SandboxProvider.FREESTYLE,
      connectionId: input.connectionId,
    });
  }

  return assertUnreachableSandboxProvider(input.provider);
}

function assertUnreachableSandboxProvider(_provider: never): never {
  throw new BadRequestError("UNSUPPORTED_SANDBOX_PROVIDER", "Sandbox provider is not supported.");
}

function resolveManagedModalCredentials(
  ctx: ResolveSandboxRuntimeCredentialsContext,
): ResolvedSandboxRuntimeCredentials {
  if (ctx.sandboxConfig.modal?.enabled !== true) {
    throw new BadRequestError(
      "MANAGED_SANDBOX_PROVIDER_UNAVAILABLE",
      "Managed Modal sandbox runtime is not configured for this deployment.",
    );
  }

  return {
    provider: SandboxProvider.MODAL,
    source: "managed",
    tokenId: ctx.sandboxConfig.modal.tokenId,
    tokenSecret: ctx.sandboxConfig.modal.tokenSecret,
    appName: ctx.sandboxConfig.modal.appName,
    ...(ctx.sandboxConfig.modal.environment === undefined
      ? {}
      : { environment: ctx.sandboxConfig.modal.environment }),
    ...(ctx.sandboxConfig.modal.defaultTimeoutMs === undefined
      ? {}
      : { defaultTimeoutMs: ctx.sandboxConfig.modal.defaultTimeoutMs }),
  };
}

function resolveManagedTensorlakeCredentials(
  ctx: ResolveSandboxRuntimeCredentialsContext,
): ResolvedSandboxRuntimeCredentials {
  if (ctx.sandboxConfig.tensorlake?.enabled !== true) {
    throw new BadRequestError(
      "MANAGED_SANDBOX_PROVIDER_UNAVAILABLE",
      "Managed Tensorlake sandbox runtime is not configured for this deployment.",
    );
  }

  return {
    provider: SandboxProvider.TENSORLAKE,
    source: "managed",
    apiKey: ctx.sandboxConfig.tensorlake.apiKey,
  };
}

function resolveManagedOpenComputerCredentials(
  ctx: ResolveSandboxRuntimeCredentialsContext,
): ResolvedSandboxRuntimeCredentials {
  if (ctx.sandboxConfig.opencomputer?.enabled !== true) {
    throw new BadRequestError(
      "MANAGED_SANDBOX_PROVIDER_UNAVAILABLE",
      "Managed OpenComputer sandbox runtime is not configured for this deployment.",
    );
  }

  return {
    provider: SandboxProvider.OPENCOMPUTER,
    source: "managed",
    apiKey: ctx.sandboxConfig.opencomputer.apiKey,
    ...(ctx.sandboxConfig.opencomputer.apiBaseUrl === undefined
      ? {}
      : { apiBaseUrl: ctx.sandboxConfig.opencomputer.apiBaseUrl }),
  };
}

function resolveManagedE2BCredentials(
  ctx: ResolveSandboxRuntimeCredentialsContext,
): ResolvedSandboxRuntimeCredentials {
  if (ctx.sandboxConfig.e2b?.enabled !== true) {
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

function resolveManagedFreestyleCredentials(
  ctx: ResolveSandboxRuntimeCredentialsContext,
): ResolvedSandboxRuntimeCredentials {
  if (ctx.sandboxConfig.freestyle?.enabled !== true) {
    throw new BadRequestError(
      "MANAGED_SANDBOX_PROVIDER_UNAVAILABLE",
      "Managed Freestyle sandbox runtime is not configured for this deployment.",
    );
  }

  return {
    provider: SandboxProvider.FREESTYLE,
    source: "managed",
    apiKey: ctx.sandboxConfig.freestyle.apiKey,
    ...(ctx.sandboxConfig.freestyle.baseUrl === undefined
      ? {}
      : { baseUrl: ctx.sandboxConfig.freestyle.baseUrl }),
  };
}

async function resolveConnectionOpenComputerCredentials(
  ctx: ResolveSandboxRuntimeCredentialsContext,
  input: ResolveSandboxRuntimeCredentialsInput & {
    provider: typeof SandboxProvider.OPENCOMPUTER;
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

  if (definition.sandboxRuntime.providerId !== SandboxProvider.OPENCOMPUTER) {
    throw new BadRequestError(
      "SANDBOX_CONNECTION_PROVIDER_MISMATCH",
      `Sandbox connection '${connection.id}' does not match sandbox provider 'opencomputer'.`,
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
      secretType: OpenComputerSandboxRuntimeCredentialSecretTypes.API_KEY,
      slotKey: OpenComputerSandboxRuntimeCredentialSlotKeys.API_KEY,
    },
  );

  if (resolvedCredential.kind !== "value") {
    throw new Error("OpenComputer sandbox runtime API key must resolve to a string credential.");
  }

  const targetConfig = OpenComputerSandboxRuntimeTargetConfigSchema.parse(target.config);

  return {
    provider: SandboxProvider.OPENCOMPUTER,
    source: "connection",
    apiKey: resolvedCredential.value,
    ...(targetConfig.apiBaseUrl === undefined ? {} : { apiBaseUrl: targetConfig.apiBaseUrl }),
  };
}

async function resolveConnectionTensorlakeCredentials(
  ctx: ResolveSandboxRuntimeCredentialsContext,
  input: ResolveSandboxRuntimeCredentialsInput & {
    provider: typeof SandboxProvider.TENSORLAKE;
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

  if (definition.sandboxRuntime.providerId !== SandboxProvider.TENSORLAKE) {
    throw new BadRequestError(
      "SANDBOX_CONNECTION_PROVIDER_MISMATCH",
      `Sandbox connection '${connection.id}' does not match sandbox provider 'tensorlake'.`,
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
      secretType: TensorlakeSandboxRuntimeCredentialSecretTypes.API_KEY,
      slotKey: TensorlakeSandboxRuntimeCredentialSlotKeys.API_KEY,
    },
  );

  if (resolvedCredential.kind !== "value") {
    throw new Error("Tensorlake sandbox runtime API key must resolve to a string credential.");
  }

  return {
    provider: SandboxProvider.TENSORLAKE,
    source: "connection",
    apiKey: resolvedCredential.value,
  };
}

async function resolveConnectionModalCredentials(
  ctx: ResolveSandboxRuntimeCredentialsContext,
  input: ResolveSandboxRuntimeCredentialsInput & {
    provider: typeof SandboxProvider.MODAL;
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

  if (definition.sandboxRuntime.providerId !== SandboxProvider.MODAL) {
    throw new BadRequestError(
      "SANDBOX_CONNECTION_PROVIDER_MISMATCH",
      `Sandbox connection '${connection.id}' does not match sandbox provider 'modal'.`,
    );
  }

  const tokenIdCredential = await resolveIntegrationCredential(
    {
      db: ctx.db,
      integrationRegistry: ctx.integrationRegistry,
      integrationsConfig: ctx.integrationsConfig,
    },
    {
      connectionId: connection.id,
      secretType: ModalSandboxRuntimeCredentialSecretTypes.TOKEN_ID,
      slotKey: ModalSandboxRuntimeCredentialSlotKeys.TOKEN_ID,
    },
  );

  if (tokenIdCredential.kind !== "value") {
    throw new Error("Modal sandbox runtime token ID must resolve to a string credential.");
  }

  const tokenSecretCredential = await resolveIntegrationCredential(
    {
      db: ctx.db,
      integrationRegistry: ctx.integrationRegistry,
      integrationsConfig: ctx.integrationsConfig,
    },
    {
      connectionId: connection.id,
      secretType: ModalSandboxRuntimeCredentialSecretTypes.TOKEN_SECRET,
      slotKey: ModalSandboxRuntimeCredentialSlotKeys.TOKEN_SECRET,
    },
  );

  if (tokenSecretCredential.kind !== "value") {
    throw new Error("Modal sandbox runtime token secret must resolve to a string credential.");
  }

  return {
    provider: SandboxProvider.MODAL,
    source: "connection",
    tokenId: tokenIdCredential.value,
    tokenSecret: tokenSecretCredential.value,
    appName: ModalSandboxRuntimeDefaultAppName,
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

async function resolveConnectionFreestyleCredentials(
  ctx: ResolveSandboxRuntimeCredentialsContext,
  input: ResolveSandboxRuntimeCredentialsInput & {
    provider: typeof SandboxProvider.FREESTYLE;
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

  if (definition.sandboxRuntime.providerId !== SandboxProvider.FREESTYLE) {
    throw new BadRequestError(
      "SANDBOX_CONNECTION_PROVIDER_MISMATCH",
      `Sandbox connection '${connection.id}' does not match sandbox provider 'freestyle'.`,
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
      secretType: FreestyleSandboxRuntimeCredentialSecretTypes.API_KEY,
      slotKey: FreestyleSandboxRuntimeCredentialSlotKeys.API_KEY,
    },
  );

  if (resolvedCredential.kind !== "value") {
    throw new Error("Freestyle sandbox runtime API key must resolve to a string credential.");
  }

  const targetConfig = FreestyleSandboxRuntimeTargetConfigSchema.parse(target.config);

  return {
    provider: SandboxProvider.FREESTYLE,
    source: "connection",
    apiKey: resolvedCredential.value,
    ...(targetConfig.baseUrl === undefined ? {} : { baseUrl: targetConfig.baseUrl }),
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
