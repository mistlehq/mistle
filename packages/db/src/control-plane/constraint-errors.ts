import { isPostgresUniqueConstraintError } from "../postgres-errors.js";

export const ControlPlaneConstraintIds = {
  SANDBOX_PROFILE_VERSIONS_ONE_DRAFT_PER_PROFILE: "sandbox_profile_versions_one_draft_per_profile",
  TRIGGER_RUN_SOURCE_SCHEDULED_ACTION: "trigger_run_source_scheduled_action",
  SNAPSHOT_JOB_ACTIVE_PER_VERSION: "snapshot_job_active_per_version",
  SNAPSHOT_JOB_SOURCE_SCHEDULED_ACTION: "snapshot_job_source_scheduled_action",
} as const;

export type ControlPlaneConstraintId =
  (typeof ControlPlaneConstraintIds)[keyof typeof ControlPlaneConstraintIds];

const ControlPlaneUniqueConstraintNamesById: Record<
  ControlPlaneConstraintId,
  ReadonlyArray<string>
> = {
  [ControlPlaneConstraintIds.SANDBOX_PROFILE_VERSIONS_ONE_DRAFT_PER_PROFILE]: [
    "sandbox_profile_versions_one_draft_per_profile_uidx",
    "sandbox_profile_versions_pkey",
  ],
  [ControlPlaneConstraintIds.TRIGGER_RUN_SOURCE_SCHEDULED_ACTION]: [
    "trigger_runs_source_scheduled_action_id_uidx",
  ],
  [ControlPlaneConstraintIds.SNAPSHOT_JOB_ACTIVE_PER_VERSION]: [
    "spv_snapshot_jobs_active_job_per_version_uidx",
    "sandbox_profile_version_snaps_sandbox_profile_id_sandbox_pr_idx",
  ],
  [ControlPlaneConstraintIds.SNAPSHOT_JOB_SOURCE_SCHEDULED_ACTION]: [
    "spv_snapshot_jobs_source_scheduled_action_id_uidx",
  ],
};

export function isControlPlaneUniqueViolation(
  error: unknown,
  constraintId: ControlPlaneConstraintId,
): boolean {
  return ControlPlaneUniqueConstraintNamesById[constraintId].some((constraintName) =>
    isPostgresUniqueConstraintError(error, constraintName),
  );
}
