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
  familyId?: string;
  targetKey: string;
  variantId: string;
  enabled: boolean;
}) {
  return {
    targetKey: input.targetKey,
    familyId: input.familyId ?? "openai",
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

export function createSandboxProfileGraphFixtures(input: {
  organizationId: string;
  profiles: ReadonlyArray<{
    id: string;
    displayName: string;
    createdAt: string;
    updatedAt?: string;
    versions: readonly number[];
    bindings?: ReadonlyArray<{
      connectionId: string;
      id: string;
      kind: IntegrationBindingKind;
      sandboxProfileVersion: number;
    }>;
  }>;
}) {
  return {
    sandboxProfiles: input.profiles.map((profile) =>
      createSandboxProfileFixture({
        id: profile.id,
        organizationId: input.organizationId,
        displayName: profile.displayName,
        createdAt: profile.createdAt,
        ...(profile.updatedAt === undefined ? {} : { updatedAt: profile.updatedAt }),
      }),
    ),
    sandboxProfileVersions: input.profiles.flatMap((profile) =>
      profile.versions.map((version) =>
        createSandboxProfileVersionFixture({
          sandboxProfileId: profile.id,
          version,
        }),
      ),
    ),
    sandboxProfileVersionIntegrationBindings: input.profiles.flatMap((profile) =>
      (profile.bindings ?? []).map((binding) =>
        createSandboxProfileVersionIntegrationBindingFixture({
          id: binding.id,
          sandboxProfileId: profile.id,
          sandboxProfileVersion: binding.sandboxProfileVersion,
          connectionId: binding.connectionId,
          kind: binding.kind,
        }),
      ),
    ),
  };
}
