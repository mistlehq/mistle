import {
  type IntegrationBindingKind,
  type IntegrationConnectionStatus,
  SandboxProfileStatuses,
} from "@mistle/db/control-plane";

export function createSandboxProfileFixture(input: {
  id: string;
  organizationId: string;
  displayName: string;
  createdAt: string;
  updatedAt?: string;
}) {
  return {
    id: input.id,
    organizationId: input.organizationId,
    displayName: input.displayName,
    status: SandboxProfileStatuses.ACTIVE,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt ?? input.createdAt,
  };
}

export function createSandboxProfileVersionFixture(input: {
  sandboxProfileId: string;
  version: number;
}) {
  return {
    sandboxProfileId: input.sandboxProfileId,
    version: input.version,
  };
}

export function createIntegrationTargetFixture(input: {
  targetKey: string;
  variantId: string;
  enabled: boolean;
}) {
  return {
    targetKey: input.targetKey,
    familyId: "openai",
    variantId: input.variantId,
    enabled: input.enabled,
    config: {
      api_base_url: "https://api.openai.com/v1",
    },
  };
}

export function createIntegrationConnectionFixture(input: {
  id: string;
  organizationId: string;
  targetKey: string;
  displayName: string;
  status: IntegrationConnectionStatus;
}) {
  return {
    id: input.id,
    organizationId: input.organizationId,
    targetKey: input.targetKey,
    displayName: input.displayName,
    status: input.status,
  };
}

export function createSandboxProfileVersionIntegrationBindingFixture(input: {
  id: string;
  sandboxProfileId: string;
  sandboxProfileVersion: number;
  connectionId: string;
  kind: IntegrationBindingKind;
}) {
  return {
    id: input.id,
    sandboxProfileId: input.sandboxProfileId,
    sandboxProfileVersion: input.sandboxProfileVersion,
    connectionId: input.connectionId,
    kind: input.kind,
    config: {},
  };
}
