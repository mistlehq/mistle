import {
  type IntegrationBindingKind,
  type IntegrationConnectionStatus,
  SandboxProfileStatuses,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";

export function sandboxProfileRow(input: {
  id: string;
  organizationId: string;
  displayName: string;
  createdAt: string;
  activeVersion?: number | null;
  updatedAt?: string;
}) {
  return {
    id: input.id,
    organizationId: input.organizationId,
    displayName: input.displayName,
    ...(input.activeVersion === undefined ? {} : { activeVersion: input.activeVersion }),
    status: SandboxProfileStatuses.ACTIVE,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt ?? input.createdAt,
  };
}

export function sandboxProfileVersionRow(input: {
  sandboxProfileId: string;
  version: number;
  state?: "draft" | "published";
  publishedAt?: string | null;
  setupScript?: string | null;
}) {
  return {
    sandboxProfileId: input.sandboxProfileId,
    version: input.version,
    state: input.state ?? SandboxProfileVersionStates.PUBLISHED,
    publishedAt:
      input.publishedAt === undefined
        ? input.state === SandboxProfileVersionStates.DRAFT
          ? null
          : "2026-01-01T00:00:00.000Z"
        : input.publishedAt,
    ...(input.setupScript === undefined ? {} : { setupScript: input.setupScript }),
  };
}

export function integrationTargetRow(input: {
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

export function integrationConnectionRow(input: {
  id: string;
  organizationId: string;
  targetKey: string;
  displayName: string;
  status: IntegrationConnectionStatus;
  config?: Record<string, unknown>;
}) {
  return {
    id: input.id,
    organizationId: input.organizationId,
    targetKey: input.targetKey,
    displayName: input.displayName,
    status: input.status,
    ...(input.config === undefined ? {} : { config: input.config }),
  };
}

export function sandboxProfileVersionIntegrationBindingRow(input: {
  id: string;
  sandboxProfileId: string;
  sandboxProfileVersion: number;
  connectionId: string;
  kind: IntegrationBindingKind;
  config?: Record<string, unknown>;
}) {
  return {
    id: input.id,
    sandboxProfileId: input.sandboxProfileId,
    sandboxProfileVersion: input.sandboxProfileVersion,
    connectionId: input.connectionId,
    kind: input.kind,
    config: input.config ?? {},
  };
}
