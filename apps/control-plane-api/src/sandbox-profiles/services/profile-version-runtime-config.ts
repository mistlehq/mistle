import type { ControlPlaneDatabase, ControlPlaneTransaction } from "@mistle/db/control-plane";
import { IntegrationConnectionStatuses } from "@mistle/db/control-plane";
import {
  IntegrationKinds,
  type IntegrationRegistry,
  type SandboxRuntimeResourceCapabilities,
} from "@mistle/integrations-core";
import { SandboxProvider } from "@mistle/sandbox";
import type { SandboxRuntimeProviderInput } from "@mistle/workflow-registry/data-plane";

import type { ControlPlaneApiSandboxRuntimeConfig } from "../../types.js";
import {
  SandboxProfilePublishabilityIssueCodes,
  type SandboxProfilePublishabilityIssueCode,
} from "../errors.js";

export type SandboxProfileVersionResources = {
  vcpuCount: number;
  memoryMb: number;
  storageMb?: number | undefined;
};

export type SandboxProfileVersionRuntimeConfig = {
  sandboxProvider: string | null;
  sandboxConnectionId: string | null;
  sandboxResources: SandboxProfileVersionResources | null;
};

export type SandboxProfileVersionRuntimeConfigColumns = {
  sandboxProvider: string | null;
  sandboxConnectionId: string | null;
  sandboxVcpuCount: number | null;
  sandboxMemoryMb: number | null;
  sandboxStorageMb: number | null;
};

export type SandboxRuntimeConfigValidationIssue = {
  code: SandboxProfilePublishabilityIssueCode;
  message: string;
  connectionId?: string;
  targetKey?: string;
};

export function createWorkflowSandboxRuntime(
  runtimeConfig: SandboxProfileVersionRuntimeConfig,
): SandboxRuntimeProviderInput {
  const provider = assertSandboxRuntimeProvider(runtimeConfig.sandboxProvider);
  const resources =
    runtimeConfig.sandboxResources === null
      ? undefined
      : {
          vcpuCount: runtimeConfig.sandboxResources.vcpuCount,
          memoryMb: runtimeConfig.sandboxResources.memoryMb,
          ...(runtimeConfig.sandboxResources.storageMb === undefined
            ? {}
            : { storageMb: runtimeConfig.sandboxResources.storageMb }),
        };

  return {
    provider,
    ...(runtimeConfig.sandboxConnectionId === null
      ? {}
      : { connectionId: runtimeConfig.sandboxConnectionId }),
    ...(resources === undefined ? {} : { resources }),
  };
}

function assertSandboxRuntimeProvider(provider: string | null): SandboxProvider {
  if (provider === null) {
    throw new Error("Sandbox profile version runtime provider is missing.");
  }

  if (provider === SandboxProvider.DOCKER || provider === SandboxProvider.E2B) {
    return provider;
  }

  throw new Error(`Unsupported sandbox profile version runtime provider '${provider}'.`);
}

export function createDefaultProfileVersionRuntimeConfig(input: {
  integrationRegistry: IntegrationRegistry;
  sandboxConfig: ControlPlaneApiSandboxRuntimeConfig;
}): SandboxProfileVersionRuntimeConfigColumns {
  if (input.sandboxConfig.provider === SandboxProvider.DOCKER) {
    return {
      sandboxProvider: SandboxProvider.DOCKER,
      sandboxConnectionId: null,
      sandboxVcpuCount: null,
      sandboxMemoryMb: null,
      sandboxStorageMb: null,
    };
  }

  if (input.sandboxConfig.provider === SandboxProvider.E2B) {
    const resourceCapabilities = findSandboxRuntimeResourceCapabilities({
      integrationRegistry: input.integrationRegistry,
      providerId: SandboxProvider.E2B,
    });

    return {
      sandboxProvider: SandboxProvider.E2B,
      sandboxConnectionId: null,
      sandboxVcpuCount: resourceCapabilities.vcpuCount.default,
      sandboxMemoryMb: resourceCapabilities.memoryMb.default,
      sandboxStorageMb: resourceCapabilities.storageMb?.default ?? null,
    };
  }

  throw new Error("Unsupported sandbox provider.");
}

export function mapProfileVersionRuntimeConfig(
  columns: SandboxProfileVersionRuntimeConfigColumns,
): SandboxProfileVersionRuntimeConfig {
  return {
    sandboxProvider: columns.sandboxProvider,
    sandboxConnectionId: columns.sandboxConnectionId,
    sandboxResources: mapProfileVersionResources(columns),
  };
}

function mapProfileVersionResources(
  columns: Pick<
    SandboxProfileVersionRuntimeConfigColumns,
    "sandboxVcpuCount" | "sandboxMemoryMb" | "sandboxStorageMb"
  >,
): SandboxProfileVersionResources | null {
  if (columns.sandboxVcpuCount === null || columns.sandboxMemoryMb === null) {
    return null;
  }

  return {
    vcpuCount: columns.sandboxVcpuCount,
    memoryMb: columns.sandboxMemoryMb,
    ...(columns.sandboxStorageMb === null ? {} : { storageMb: columns.sandboxStorageMb }),
  };
}

export async function validateSandboxProfileVersionRuntimeConfig(
  {
    db,
    integrationRegistry,
    sandboxConfig,
  }: {
    db: ControlPlaneDatabase | ControlPlaneTransaction;
    integrationRegistry: IntegrationRegistry;
    sandboxConfig: ControlPlaneApiSandboxRuntimeConfig;
  },
  input: {
    organizationId: string;
    runtimeConfig: SandboxProfileVersionRuntimeConfig;
  },
): Promise<SandboxRuntimeConfigValidationIssue[]> {
  const providerId = input.runtimeConfig.sandboxProvider;
  if (providerId === null) {
    return [
      {
        code: SandboxProfilePublishabilityIssueCodes.SANDBOX_PROVIDER_REQUIRED,
        message:
          "Sandbox profile version must declare a sandbox provider before it can be published.",
      },
    ];
  }

  if (providerId === SandboxProvider.DOCKER) {
    return validateDockerRuntimeConfig(input.runtimeConfig);
  }

  const sandboxRuntimeDefinition = findSandboxRuntimeDefinition({
    integrationRegistry,
    providerId,
  });

  if (sandboxRuntimeDefinition === undefined) {
    return [
      {
        code: SandboxProfilePublishabilityIssueCodes.INVALID_SANDBOX_PROVIDER,
        message: `Sandbox provider '${providerId}' is not supported.`,
      },
    ];
  }

  const issues = validateSandboxResources({
    providerId,
    resources: input.runtimeConfig.sandboxResources,
    resourceCapabilities: sandboxRuntimeDefinition.sandboxRuntime.resourceCapabilities,
  });

  if (input.runtimeConfig.sandboxConnectionId === null) {
    if (sandboxConfig.provider !== providerId) {
      issues.push({
        code: SandboxProfilePublishabilityIssueCodes.SANDBOX_MANAGED_PROVIDER_UNAVAILABLE,
        message: `Managed sandbox provider '${providerId}' is not configured for this deployment.`,
      });
    }

    return issues;
  }

  return [
    ...issues,
    ...(await validateSandboxConnection({
      db,
      integrationRegistry,
      organizationId: input.organizationId,
      providerId,
      connectionId: input.runtimeConfig.sandboxConnectionId,
    })),
  ];
}

export function findSandboxRuntimeResourceCapabilities(input: {
  integrationRegistry: IntegrationRegistry;
  providerId: string;
}): SandboxRuntimeResourceCapabilities {
  const definition = findSandboxRuntimeDefinition(input);

  if (definition === undefined) {
    throw new Error(`Sandbox runtime definition for provider '${input.providerId}' was not found.`);
  }

  return definition.sandboxRuntime.resourceCapabilities;
}

function findSandboxRuntimeDefinition(input: {
  integrationRegistry: IntegrationRegistry;
  providerId: string;
}):
  | {
      sandboxRuntime: {
        providerId: string;
        resourceCapabilities: SandboxRuntimeResourceCapabilities;
      };
    }
  | undefined {
  const definition = input.integrationRegistry
    .listDefinitions()
    .find(
      (candidate) =>
        candidate.kind === IntegrationKinds.SANDBOX &&
        candidate.sandboxRuntime?.providerId === input.providerId,
    );

  if (definition?.sandboxRuntime === undefined) {
    return undefined;
  }

  return {
    sandboxRuntime: definition.sandboxRuntime,
  };
}

function validateDockerRuntimeConfig(
  runtimeConfig: SandboxProfileVersionRuntimeConfig,
): SandboxRuntimeConfigValidationIssue[] {
  const issues: SandboxRuntimeConfigValidationIssue[] = [];

  if (runtimeConfig.sandboxConnectionId !== null) {
    issues.push({
      code: SandboxProfilePublishabilityIssueCodes.INVALID_SANDBOX_CONNECTION_REFERENCE,
      message: "Docker sandbox profiles cannot reference a sandbox connection.",
      connectionId: runtimeConfig.sandboxConnectionId,
    });
  }

  if (runtimeConfig.sandboxResources !== null) {
    issues.push({
      code: SandboxProfilePublishabilityIssueCodes.INVALID_SANDBOX_RESOURCES,
      message: "Docker sandbox profiles cannot declare remote sandbox resources.",
    });
  }

  return issues;
}

function validateSandboxResources(input: {
  providerId: string;
  resources: SandboxProfileVersionResources | null;
  resourceCapabilities: SandboxRuntimeResourceCapabilities;
}): SandboxRuntimeConfigValidationIssue[] {
  if (input.resources === null) {
    return [
      {
        code: SandboxProfilePublishabilityIssueCodes.INVALID_SANDBOX_RESOURCES,
        message: `Sandbox provider '${input.providerId}' requires vCPU and memory resources.`,
      },
    ];
  }

  const issues: SandboxRuntimeConfigValidationIssue[] = [];

  if (
    !isValidCapabilityValue(input.resources.vcpuCount, input.resourceCapabilities.vcpuCount) ||
    !isValidCapabilityValue(input.resources.memoryMb, input.resourceCapabilities.memoryMb)
  ) {
    issues.push({
      code: SandboxProfilePublishabilityIssueCodes.INVALID_SANDBOX_RESOURCES,
      message: `Sandbox provider '${input.providerId}' resources are outside supported limits.`,
    });
  }

  if (input.resourceCapabilities.storageMb === undefined) {
    if (input.resources.storageMb !== undefined) {
      issues.push({
        code: SandboxProfilePublishabilityIssueCodes.INVALID_SANDBOX_RESOURCES,
        message: `Sandbox provider '${input.providerId}' does not support configurable storage.`,
      });
    }

    return issues;
  }

  if (
    input.resources.storageMb !== undefined &&
    !isValidCapabilityValue(input.resources.storageMb, input.resourceCapabilities.storageMb)
  ) {
    issues.push({
      code: SandboxProfilePublishabilityIssueCodes.INVALID_SANDBOX_RESOURCES,
      message: `Sandbox provider '${input.providerId}' storage is outside supported limits.`,
    });
  }

  return issues;
}

function isValidCapabilityValue(
  value: number,
  capability: SandboxRuntimeResourceCapabilities["vcpuCount"],
): boolean {
  return (
    Number.isInteger(value) &&
    value >= capability.min &&
    value <= capability.max &&
    (value - capability.min) % capability.step === 0
  );
}

async function validateSandboxConnection(input: {
  db: ControlPlaneDatabase | ControlPlaneTransaction;
  integrationRegistry: IntegrationRegistry;
  organizationId: string;
  providerId: string;
  connectionId: string;
}): Promise<SandboxRuntimeConfigValidationIssue[]> {
  const connection = await input.db.query.integrationConnections.findFirst({
    columns: {
      id: true,
      status: true,
      targetKey: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.id, input.connectionId), eq(table.organizationId, input.organizationId)),
  });

  if (connection === undefined) {
    return [
      {
        code: SandboxProfilePublishabilityIssueCodes.INVALID_SANDBOX_CONNECTION_REFERENCE,
        message: `Sandbox connection '${input.connectionId}' is missing or inaccessible.`,
        connectionId: input.connectionId,
      },
    ];
  }

  const issues: SandboxRuntimeConfigValidationIssue[] = [];

  if (connection.status !== IntegrationConnectionStatuses.ACTIVE) {
    issues.push({
      code: SandboxProfilePublishabilityIssueCodes.SANDBOX_CONNECTION_NOT_ACTIVE,
      message: `Sandbox connection '${connection.id}' is not active.`,
      connectionId: connection.id,
    });
  }

  const target = await input.db.query.integrationTargets.findFirst({
    columns: {
      targetKey: true,
      familyId: true,
      variantId: true,
      enabled: true,
    },
    where: (table, { eq }) => eq(table.targetKey, connection.targetKey),
  });

  if (target === undefined) {
    throw new Error(
      `Expected integration target '${connection.targetKey}' to exist for sandbox connection '${connection.id}'.`,
    );
  }

  if (!target.enabled) {
    issues.push({
      code: SandboxProfilePublishabilityIssueCodes.TARGET_DISABLED,
      message: `Sandbox connection '${connection.id}' references disabled target '${target.targetKey}'.`,
      connectionId: connection.id,
      targetKey: target.targetKey,
    });
  }

  const definition = input.integrationRegistry.getDefinition({
    familyId: target.familyId,
    variantId: target.variantId,
  });

  if (definition?.kind !== IntegrationKinds.SANDBOX || definition.sandboxRuntime === undefined) {
    issues.push({
      code: SandboxProfilePublishabilityIssueCodes.SANDBOX_CONNECTION_KIND_MISMATCH,
      message: `Sandbox connection '${connection.id}' does not reference a sandbox integration target.`,
      connectionId: connection.id,
      targetKey: target.targetKey,
    });
    return issues;
  }

  if (definition.sandboxRuntime.providerId !== input.providerId) {
    issues.push({
      code: SandboxProfilePublishabilityIssueCodes.SANDBOX_CONNECTION_PROVIDER_MISMATCH,
      message: `Sandbox connection '${connection.id}' does not match sandbox provider '${input.providerId}'.`,
      connectionId: connection.id,
      targetKey: target.targetKey,
    });
  }

  return issues;
}
