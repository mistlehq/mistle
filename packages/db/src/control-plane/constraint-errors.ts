import { isPostgresUniqueConstraintError } from "../postgres-errors.js";

export const ControlPlaneConstraintIds = {
  SANDBOX_PROFILE_VERSIONS_ONE_DRAFT_PER_PROFILE: "sandbox_profile_versions_one_draft_per_profile",
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
};

export function isControlPlaneUniqueViolation(
  error: unknown,
  constraintId: ControlPlaneConstraintId,
): boolean {
  return ControlPlaneUniqueConstraintNamesById[constraintId].some((constraintName) =>
    isPostgresUniqueConstraintError(error, constraintName),
  );
}
