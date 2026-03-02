import type {
  ControlPlaneDatabase,
  IntegrationBindingKind,
  SandboxProfile,
  SandboxProfileStatus,
  SandboxProfileVersionIntegrationBinding,
} from "@mistle/db/control-plane";
import type { SandboxInstanceSource, SandboxInstanceStarterKind } from "@mistle/db/data-plane";
import type { ConnectionTokenConfig } from "@mistle/gateway-connection-auth";
import type { KeysetPaginatedResult } from "@mistle/http/pagination";
import type { CompiledRuntimePlan, ResolvedSandboxImage } from "@mistle/integrations-core";
import type {
  StartSandboxProfileInstanceWorkflowInput,
  createControlPlaneOpenWorkflow,
} from "@mistle/workflows/control-plane";

import type { ListProfilesInput } from "./list-profiles.js";

export type ControlPlaneOpenWorkflow = ReturnType<typeof createControlPlaneOpenWorkflow>;

export type CreateSandboxProfilesServiceInput = {
  db: ControlPlaneDatabase;
  openWorkflow: ControlPlaneOpenWorkflow;
  mintSandboxInstanceConnectionToken?: (input: {
    organizationId: string;
    instanceId: string;
    gatewayWebsocketUrl: string;
    tokenTtlSeconds: number;
    tokenConfig: ConnectionTokenConfig;
  }) => Promise<{
    instanceId: string;
    url: string;
    token: string;
    expiresAt: string;
  }>;
};

export type SandboxProfilesService = {
  listProfiles: (input: ListProfilesInput) => Promise<KeysetPaginatedResult<SandboxProfile>>;
  createProfile: (input: {
    organizationId: string;
    displayName: string;
    status?: SandboxProfileStatus | undefined;
  }) => Promise<SandboxProfile>;
  getProfile: (input: { organizationId: string; profileId: string }) => Promise<SandboxProfile>;
  updateProfile: (input: {
    organizationId: string;
    profileId: string;
    displayName?: string | undefined;
    status?: SandboxProfileStatus | undefined;
  }) => Promise<SandboxProfile>;
  requestDeleteProfile: (input: { organizationId: string; profileId: string }) => Promise<{
    profileId: string;
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
    issueConnectionToken?: boolean;
    connectionToken?: {
      gatewayWebsocketUrl: string;
      tokenTtlSeconds: number;
      tokenConfig: ConnectionTokenConfig;
    };
    startedBy: {
      kind: SandboxInstanceStarterKind;
      id: string;
    };
    source: SandboxInstanceSource;
    image: StartSandboxProfileInstanceWorkflowInput["image"];
  }) => Promise<{
    status: "completed";
    workflowRunId: string;
    sandboxInstanceId: string;
    providerSandboxId: string;
    connection?: {
      url: string;
      token: string;
      expiresAt: string;
    };
  }>;
  compileProfileVersionRuntimePlan: (input: {
    organizationId: string;
    profileId: string;
    profileVersion: number;
    image: ResolvedSandboxImage;
    runtimeContext: {
      sandboxdEgressBaseUrl: string;
    };
  }) => Promise<CompiledRuntimePlan>;
};
