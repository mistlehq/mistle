import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import type {
  ControlPlaneDatabase,
  SandboxProfile,
  SandboxProfileVersionAgentRuntimeId,
  SandboxProfileVersionDefaultPersistenceMode,
  SandboxProfileVersionState,
  SandboxProfileVersionIntegrationBinding,
} from "@mistle/db/control-plane";
import type { SandboxInstanceSource, SandboxInstanceStarterKind } from "@mistle/db/data-plane";
import type { KeysetPaginatedResult } from "@mistle/http/pagination";
import type {
  CompiledRuntimePlan,
  IntegrationRegistry,
  ResolvedSandboxImage,
} from "@mistle/integrations-core";

import type { createControlPlaneOpenWorkflow } from "../../openworkflow.js";
import type { ControlPlaneApiMcpConfig, ControlPlaneApiSandboxRuntimeConfig } from "../../types.js";
import type { ListProfilesInput } from "./list-profiles.js";
import type { SandboxProfileVersionResources } from "./profile-version-runtime-config.js";

export type ControlPlaneOpenWorkflow = ReturnType<typeof createControlPlaneOpenWorkflow>;

export type CreateSandboxProfilesServiceInput = {
  db: ControlPlaneDatabase;
  integrationRegistry: IntegrationRegistry;
  sandboxConfig: ControlPlaneApiSandboxRuntimeConfig;
  openWorkflow: ControlPlaneOpenWorkflow;
  integrationsConfig: {
    activeMasterEncryptionKeyVersion: number;
    masterEncryptionKeys: Record<string, string>;
  };
  mcpConfig: ControlPlaneApiMcpConfig;
  dataPlaneClient: Pick<
    DataPlaneSandboxInstancesClient,
    "materializeSandboxProfileVersionSnapshotJob" | "startSandboxInstance"
  >;
};

export type SandboxProfilesService = {
  listProfiles: (input: ListProfilesInput) => Promise<KeysetPaginatedResult<SandboxProfile>>;
  createProfile: (input: {
    organizationId: string;
    displayName: string;
  }) => Promise<SandboxProfile>;
  createProfileVersionDraft: (input: { organizationId: string; profileId: string }) => Promise<{
    sandboxProfileId: string;
    version: number;
    state: SandboxProfileVersionState;
    defaultPersistenceMode: SandboxProfileVersionDefaultPersistenceMode;
    agentRuntimeId: SandboxProfileVersionAgentRuntimeId;
    gitCommitSigningIntegrationConnectionId: string | null;
    mistleMcpEnabled: boolean;
    mistleMcpApiKeyId: string | null;
    sandboxProvider: string | null;
    sandboxConnectionId: string | null;
    sandboxResources: SandboxProfileVersionResources | null;
    isActive: boolean;
  }>;
  getProfile: (input: { organizationId: string; profileId: string }) => Promise<SandboxProfile>;
  updateProfile: (input: {
    organizationId: string;
    profileId: string;
    displayName?: string | undefined;
  }) => Promise<SandboxProfile>;
  requestDeleteProfile: (input: { organizationId: string; profileId: string }) => Promise<{
    profileId: string;
  }>;
  listProfileVersions: (input: { organizationId: string; profileId: string }) => Promise<{
    versions: Array<{
      sandboxProfileId: string;
      version: number;
      state: SandboxProfileVersionState;
      defaultPersistenceMode: SandboxProfileVersionDefaultPersistenceMode;
      agentRuntimeId: SandboxProfileVersionAgentRuntimeId;
      gitCommitSigningIntegrationConnectionId: string | null;
      mistleMcpEnabled: boolean;
      mistleMcpApiKeyId: string | null;
      sandboxProvider: string | null;
      sandboxConnectionId: string | null;
      sandboxResources: SandboxProfileVersionResources | null;
      isActive: boolean;
    }>;
  }>;
  getProfileVersionPublishability: (input: {
    organizationId: string;
    profileId: string;
    profileVersion: number;
  }) => Promise<{
    publishable: boolean;
    issues: Array<{
      code: string;
      message: string;
      bindingId?: string;
      connectionId?: string;
      targetKey?: string;
    }>;
  }>;
  getProfileVersionIntegrationBindings: (input: {
    organizationId: string;
    profileId: string;
    profileVersion: number;
  }) => Promise<{
    bindings: SandboxProfileVersionIntegrationBinding[];
  }>;
  startProfileInstance: (input: {
    organizationId: string;
    profileId: string;
    profileVersion: number;
    idempotencyKey?: string;
    startedBy: {
      kind: SandboxInstanceStarterKind;
      id: string;
    };
    source: SandboxInstanceSource;
  }) => Promise<{
    status: "accepted";
    workflowRunId: string;
    sandboxInstanceId: string;
  }>;
  compileProfileVersionRuntimePlan: (input: {
    organizationId: string;
    profileId: string;
    profileVersion: number;
    image: ResolvedSandboxImage;
  }) => Promise<CompiledRuntimePlan>;
  publishProfileVersion: (input: {
    organizationId: string;
    profileId: string;
    profileVersion: number;
  }) => Promise<{
    version: {
      sandboxProfileId: string;
      version: number;
      state: SandboxProfileVersionState;
      defaultPersistenceMode: SandboxProfileVersionDefaultPersistenceMode;
      agentRuntimeId: SandboxProfileVersionAgentRuntimeId;
      gitCommitSigningIntegrationConnectionId: string | null;
      mistleMcpEnabled: boolean;
      mistleMcpApiKeyId: string | null;
      sandboxProvider: string | null;
      sandboxConnectionId: string | null;
      sandboxResources: SandboxProfileVersionResources | null;
      isActive: boolean;
    };
    activeVersion: number | null;
    snapshotJob: {
      id: string;
      trigger: "publish";
      state: "queued";
    };
  }>;
  discardProfileVersionDraft: (input: {
    organizationId: string;
    profileId: string;
    profileVersion: number;
  }) => Promise<{
    discardedVersion: number;
    hasDraft: boolean;
  }>;
};
