import type {
  ControlPlaneDatabase,
  SandboxProfile,
  SandboxProfileStatus,
} from "@mistle/db/control-plane";
import type { SandboxInstanceSource, SandboxInstanceStarterKind } from "@mistle/db/data-plane";
import type { KeysetPaginatedResult } from "@mistle/http/pagination";
import type { createControlPlaneOpenWorkflow } from "@mistle/workflows/control-plane";

import type { ListProfilesInput } from "./list-profiles.js";

export type ControlPlaneOpenWorkflow = ReturnType<typeof createControlPlaneOpenWorkflow>;

export type CreateSandboxProfilesServiceInput = {
  db: ControlPlaneDatabase;
  openWorkflow: ControlPlaneOpenWorkflow;
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
  startProfileInstance: (input: {
    organizationId: string;
    profileId: string;
    profileVersion: number;
    startedBy: {
      kind: SandboxInstanceStarterKind;
      id: string;
    };
    source: SandboxInstanceSource;
  }) => Promise<{
    status: "completed";
    workflowRunId: string;
    sandboxInstanceId: string;
    providerSandboxId: string;
  }>;
};
