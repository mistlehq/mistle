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
  SandboxProfilesCompileError,
  SandboxProfilesCompileErrorCodes,
  SandboxProfilePublishabilityIssueCodes,
  type SandboxProfilePublishabilityIssueCode,
} from "../errors.js";

export type SandboxProfileVersionResources = {
  vcpuCount: number;
  memoryMb: number;
  diskMb?: number | undefined;
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
  sandboxDiskMb: number | null;
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
          ...(runtimeConfig.sandboxResources.diskMb === undefined
            ? {}
            : { diskMb: runtimeConfig.sandboxResources.diskMb }),
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
    throw new SandboxProfilesCompileError(
      SandboxProfilesCompileErrorCodes.SANDBOX_PROVIDER_REQUIRED,
      "Select a sandbox provider before starting this sandbox.",
    );
  }

  if (isSandboxProvider(provider)) {
    return provider;
  }

  throw new SandboxProfilesCompileError(
    SandboxProfilesCompileErrorCodes.INVALID_SANDBOX_PROVIDER,
    `Sandbox provider '${provider}' is not supported.`,
  );
}

export function createDefaultProfileVersionRuntimeConfig(input: {
  integrationRegistry: IntegrationRegistry;
  sandboxConfig: ControlPlaneApiSandboxRuntimeConfig;
}): SandboxProfileVersionRuntimeConfigColumns {
  void input;
  return {
    sandboxProvider: null,
    sandboxConnectionId: null,
    sandboxVcpuCount: null,
    sandboxMemoryMb: null,
    sandboxDiskMb: null,
  };
}

function isSandboxProvider(provider: string): provider is SandboxProvider {
  for (const candidate of Object.values(SandboxProvider)) {
    if (provider === candidate) {
      return true;
    }
  }

  return false;
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
    "sandboxVcpuCount" | "sandboxMemoryMb" | "sandboxDiskMb"
  >,
): SandboxProfileVersionResources | null {
  if (columns.sandboxVcpuCount === null || columns.sandboxMemoryMb === null) {
    return null;
  }

  return {
    vcpuCount: columns.sandboxVcpuCount,
    memoryMb: columns.sandboxMemoryMb,
    ...(columns.sandboxDiskMb === null ? {} : { diskMb: columns.sandboxDiskMb }),
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
    return [
      ...validateManagedSandboxProviderAvailability({
        providerId,
        sandboxConfig,
      }),
      ...validateDockerRuntimeConfig(input.runtimeConfig),
    ];
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
    issues.push(
      ...validateManagedSandboxProviderAvailability({
        providerId,
        sandboxConfig,
      }),
    );

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

function validateManagedSandboxProviderAvailability(input: {
  providerId: string;
  sandboxConfig: ControlPlaneApiSandboxRuntimeConfig;
}): SandboxRuntimeConfigValidationIssue[] {
  if (input.providerId === SandboxProvider.DOCKER && input.sandboxConfig.docker?.enabled === true) {
    return [];
  }

  if (input.providerId === SandboxProvider.E2B && input.sandboxConfig.e2b?.enabled === true) {
    return [];
  }

  if (
    input.providerId === SandboxProvider.TENSORLAKE &&
    input.sandboxConfig.tensorlake?.enabled === true
  ) {
    return [];
  }

  if (input.providerId === SandboxProvider.E2B && input.sandboxConfig.e2b?.enabled !== true) {
    return [
      {
        code: SandboxProfilePublishabilityIssueCodes.SANDBOX_MANAGED_PROVIDER_UNAVAILABLE,
        message: "Managed E2B sandbox provider credentials are not configured for this deployment.",
      },
    ];
  }

  return [
    {
      code: SandboxProfilePublishabilityIssueCodes.SANDBOX_MANAGED_PROVIDER_UNAVAILABLE,
      message: `Managed sandbox provider '${input.providerId}' is not configured for this deployment.`,
    },
  ];
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
    !isValidCapabilityValue(input.resources.memoryMb, input.resourceCapabilities.memoryMb) ||
    !isValidMemoryPerVcpuValue({
      memoryMb: input.resources.memoryMb,
      vcpuCount: input.resources.vcpuCount,
      capability: input.resourceCapabilities.memoryMb,
    })
  ) {
    issues.push({
      code: SandboxProfilePublishabilityIssueCodes.INVALID_SANDBOX_RESOURCES,
      message: `Sandbox provider '${input.providerId}' resources are outside supported limits.`,
    });
  }

  if (input.resourceCapabilities.diskMb === undefined) {
    if (input.resources.diskMb !== undefined) {
      issues.push({
        code: SandboxProfilePublishabilityIssueCodes.INVALID_SANDBOX_RESOURCES,
        message: `Sandbox provider '${input.providerId}' does not support configurable disk.`,
      });
    }

    return issues;
  }

  if (
    input.resources.diskMb !== undefined &&
    !isValidCapabilityValue(input.resources.diskMb, input.resourceCapabilities.diskMb)
  ) {
    issues.push({
      code: SandboxProfilePublishabilityIssueCodes.INVALID_SANDBOX_RESOURCES,
      message: `Sandbox provider '${input.providerId}' disk is outside supported limits.`,
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

function isValidMemoryPerVcpuValue(input: {
  memoryMb: number;
  vcpuCount: number;
  capability: SandboxRuntimeResourceCapabilities["memoryMb"];
}): boolean {
  if (
    input.capability.minPerVcpu !== undefined &&
    input.memoryMb < input.vcpuCount * input.capability.minPerVcpu
  ) {
    return false;
  }

  if (
    input.capability.maxPerVcpu !== undefined &&
    input.memoryMb > input.vcpuCount * input.capability.maxPerVcpu
  ) {
    return false;
  }

  return true;
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
