import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import type {
  ControlPlaneDatabase,
  IntegrationBindingKind,
  SandboxProfile,
  SandboxProfileVersionState,
  SandboxProfileVersionIntegrationBinding,
} from "@mistle/db/control-plane";
import type { SandboxInstanceSource, SandboxInstanceStarterKind } from "@mistle/db/data-plane";
import type { KeysetPaginatedResult } from "@mistle/http/pagination";
import type { CompiledRuntimePlan, ResolvedSandboxImage } from "@mistle/integrations-core";

import type { createControlPlaneOpenWorkflow } from "../../openworkflow.js";
import type { ListProfilesInput } from "./list-profiles.js";

export type ControlPlaneOpenWorkflow = ReturnType<typeof createControlPlaneOpenWorkflow>;

export type CreateSandboxProfilesServiceInput = {
  db: ControlPlaneDatabase;
  openWorkflow: ControlPlaneOpenWorkflow;
  integrationsConfig: {
    activeMasterEncryptionKeyVersion: number;
    masterEncryptionKeys: Record<string, string>;
  };
  dataPlaneClient: Pick<DataPlaneSandboxInstancesClient, "startSandboxInstance">;
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
  putProfileVersionIntegrationBindings: (input: {
    organizationId: string;
    profileId: string;
    profileVersion: number;
    bindings: Array<{
      id?: string;
      connectionId: string;
      kind: IntegrationBindingKind;
      config: Record<string, unknown>;
    }>;
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
    image: {
      imageId: string;
      createdAt: string;
    };
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
      isActive: boolean;
    };
    activeVersion: number;
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
