import type {
  SandboxInstancePersistenceMode,
  SandboxInstanceSource,
  SandboxInstanceStarterKind,
} from "@mistle/db/data-plane";
import type { CompiledRuntimePlan } from "@mistle/integrations-core";
import type { SandboxImageHandle, SandboxProvider } from "@mistle/sandbox";
import { defineWorkflowSpec } from "openworkflow";

export const StartSandboxInstanceWorkflowName = "data-plane.sandbox-instances.start";
export const StartSandboxInstanceWorkflowVersion = "1";
export const ResumeSandboxInstanceWorkflowName = "data-plane.sandbox-instances.resume";
export const ResumeSandboxInstanceWorkflowVersion = "1";
export const StopSandboxInstanceWorkflowName = "data-plane.sandbox-instances.stop";
export const StopSandboxInstanceWorkflowVersion = "1";
export const ReconcileSandboxInstanceWorkflowName = "data-plane.sandbox-instances.reconcile";
export const ReconcileSandboxInstanceWorkflowVersion = "1";
export const HandleSandboxInstanceDeadlineWorkflowName =
  "data-plane.sandbox-instance-deadlines.handle";
export const HandleSandboxInstanceDeadlineWorkflowVersion = "1";
export const MaterializeSandboxProfileVersionSnapshotWorkflowName =
  "data-plane.sandbox-profile-version-snapshots.materialize";
export const MaterializeSandboxProfileVersionSnapshotWorkflowVersion = "1";

export type SandboxStopReason = "idle";
export type SandboxReconcileReason = "disconnect_grace_elapsed";
export type SandboxInstanceDeadlineKind = "idle" | "disconnect";

export const SandboxStartImageKinds = {
  BASE: "base",
  SNAPSHOT: "snapshot",
} as const;
export type SandboxStartImageKind =
  (typeof SandboxStartImageKinds)[keyof typeof SandboxStartImageKinds];

export type StartSandboxInstanceWorkflowImageInput = Pick<SandboxImageHandle, "imageId"> & {
  createdAt?: SandboxImageHandle["createdAt"];
  kind: SandboxStartImageKind;
  provider?: SandboxProvider;
};

export type SandboxWorkflowGitIdentityInput = {
  name: string;
  email: string;
  signing?: {
    format: "ssh";
    program: string;
    keyRef: string;
    organizationId: string;
    providerFamily: string;
    actingUserId: string;
  };
};

export type StartSandboxInstanceWorkflowInput = {
  sandboxInstanceId: string;
  organizationId: string;
  sandboxProfileId: string;
  sandboxProfileVersion: number;
  persistenceMode: SandboxInstancePersistenceMode;
  runtimePlan: CompiledRuntimePlan;
  startedBy: {
    kind: SandboxInstanceStarterKind;
    id: string;
  };
  actingUserId?: string;
  gitIdentity?: SandboxWorkflowGitIdentityInput;
  source: SandboxInstanceSource;
  image: StartSandboxInstanceWorkflowImageInput;
};

export type StartSandboxInstanceWorkflowOutput = {
  sandboxInstanceId: string;
  providerSandboxId: string;
};

export const StartSandboxInstanceWorkflowSpec = defineWorkflowSpec<
  StartSandboxInstanceWorkflowInput,
  StartSandboxInstanceWorkflowOutput
>({
  name: StartSandboxInstanceWorkflowName,
  version: StartSandboxInstanceWorkflowVersion,
});

export type MaterializeSandboxProfileVersionSnapshotWorkflowInput = {
  snapshotJobId: string;
  sandboxInstanceId: string;
  organizationId: string;
  sandboxProfileId: string;
  sandboxProfileVersion: number;
  image: StartSandboxInstanceWorkflowImageInput;
};

export type MaterializeSandboxProfileVersionSnapshotWorkflowOutput = {
  snapshotJobId: string;
  sandboxInstanceId: string;
  claimed: boolean;
  image?: SandboxImageHandle;
};

export const MaterializeSandboxProfileVersionSnapshotWorkflowSpec = defineWorkflowSpec<
  MaterializeSandboxProfileVersionSnapshotWorkflowInput,
  MaterializeSandboxProfileVersionSnapshotWorkflowOutput
>({
  name: MaterializeSandboxProfileVersionSnapshotWorkflowName,
  version: MaterializeSandboxProfileVersionSnapshotWorkflowVersion,
});

export type ResumeSandboxInstanceWorkflowInput = {
  sandboxInstanceId: string;
  actingUserId?: string;
  gitIdentity?: SandboxWorkflowGitIdentityInput;
};

export type ResumeSandboxInstanceWorkflowOutput = {
  sandboxInstanceId: string;
};

export const ResumeSandboxInstanceWorkflowSpec = defineWorkflowSpec<
  ResumeSandboxInstanceWorkflowInput,
  ResumeSandboxInstanceWorkflowOutput
>({
  name: ResumeSandboxInstanceWorkflowName,
  version: ResumeSandboxInstanceWorkflowVersion,
});

export type StopSandboxInstanceWorkflowInput = {
  sandboxInstanceId: string;
  stopReason: SandboxStopReason;
  expectedOwnerLeaseId: string;
};

export type StopSandboxInstanceWorkflowOutput = {
  sandboxInstanceId: string;
  executed: boolean;
  outcome:
    | "stopped"
    | "already_stopped"
    | "runtime_state_fence_before_load"
    | "runtime_state_fence_before_stop"
    | "runtime_state_fence_before_mark";
};

export const StopSandboxInstanceWorkflowSpec = defineWorkflowSpec<
  StopSandboxInstanceWorkflowInput,
  StopSandboxInstanceWorkflowOutput
>({
  name: StopSandboxInstanceWorkflowName,
  version: StopSandboxInstanceWorkflowVersion,
});

export type ReconcileSandboxInstanceWorkflowInput = {
  sandboxInstanceId: string;
  reason: SandboxReconcileReason;
  expectedOwnerLeaseId: string;
};

export type ReconcileSandboxInstanceWorkflowOutput = {
  sandboxInstanceId: string;
  executed: boolean;
  outcome:
    | "failed"
    | "stopped"
    | "already_failed"
    | "already_stopped"
    | "already_terminal"
    | "runtime_state_fence_before_load"
    | "runtime_state_fence_before_inspect"
    | "runtime_state_fence_before_stop"
    | "runtime_state_fence_before_mark";
};

export const ReconcileSandboxInstanceWorkflowSpec = defineWorkflowSpec<
  ReconcileSandboxInstanceWorkflowInput,
  ReconcileSandboxInstanceWorkflowOutput
>({
  name: ReconcileSandboxInstanceWorkflowName,
  version: ReconcileSandboxInstanceWorkflowVersion,
});

export type HandleSandboxInstanceDeadlineWorkflowInput = {
  sandboxInstanceId: string;
  kind: SandboxInstanceDeadlineKind;
  ownerLeaseId: string;
  dueAt: string;
  generation: number;
};

export type HandleSandboxInstanceDeadlineWorkflowOutput = {
  sandboxInstanceId: string;
  kind: SandboxInstanceDeadlineKind;
  executed: boolean;
  outcome:
    | "executed"
    | "deadline_missing"
    | "deadline_cleared"
    | "deadline_generation_mismatch"
    | "deadline_owner_lease_mismatch"
    | "deadline_due_at_mismatch"
    | "action_failed"
    | "action_stopped"
    | "action_already_failed"
    | "action_already_stopped"
    | "action_already_terminal"
    | "action_runtime_state_fence_before_load"
    | "action_runtime_state_fence_before_stop"
    | "action_runtime_state_fence_before_mark"
    | "action_runtime_state_fence_before_inspect";
};

export const HandleSandboxInstanceDeadlineWorkflowSpec = defineWorkflowSpec<
  HandleSandboxInstanceDeadlineWorkflowInput,
  HandleSandboxInstanceDeadlineWorkflowOutput
>({
  name: HandleSandboxInstanceDeadlineWorkflowName,
  version: HandleSandboxInstanceDeadlineWorkflowVersion,
});
