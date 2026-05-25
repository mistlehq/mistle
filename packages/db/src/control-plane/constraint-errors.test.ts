import { describe, expect, it } from "vitest";

import { ControlPlaneConstraintIds, isControlPlaneUniqueViolation } from "./constraint-errors.js";

describe("control-plane constraint errors", () => {
  it("matches the port access link slug unique index", () => {
    const error = {
      code: "23505",
      constraint: "port_access_links_slug_uidx",
    };

    expect(
      isControlPlaneUniqueViolation(error, ControlPlaneConstraintIds.PORT_ACCESS_LINK_SLUG),
    ).toBe(true);
  });

  it("matches the sandbox profile one-draft unique index", () => {
    const error = {
      code: "23505",
      constraint: "sandbox_profile_versions_one_draft_per_profile_uidx",
    };

    expect(
      isControlPlaneUniqueViolation(
        error,
        ControlPlaneConstraintIds.SANDBOX_PROFILE_VERSIONS_ONE_DRAFT_PER_PROFILE,
      ),
    ).toBe(true);
  });

  it("matches the sandbox profile versions primary key for next-version races", () => {
    const error = {
      cause: {
        code: "23505",
        constraint: "sandbox_profile_versions_pkey",
      },
    };

    expect(
      isControlPlaneUniqueViolation(
        error,
        ControlPlaneConstraintIds.SANDBOX_PROFILE_VERSIONS_ONE_DRAFT_PER_PROFILE,
      ),
    ).toBe(true);
  });

  it("matches the generated snapshot job active unique index from copied test schemas", () => {
    const error = {
      cause: {
        code: "23505",
        constraint: "sandbox_profile_version_snaps_sandbox_profile_id_sandbox_pr_idx",
      },
    };

    expect(
      isControlPlaneUniqueViolation(
        error,
        ControlPlaneConstraintIds.SNAPSHOT_JOB_ACTIVE_PER_VERSION,
      ),
    ).toBe(true);
  });

  it("matches the trigger run scheduled action unique index", () => {
    const error = {
      code: "23505",
      constraint: "trigger_runs_source_scheduled_action_id_uidx",
    };

    expect(
      isControlPlaneUniqueViolation(
        error,
        ControlPlaneConstraintIds.TRIGGER_RUN_SOURCE_SCHEDULED_ACTION,
      ),
    ).toBe(true);
  });

  it("returns false for unrelated control-plane constraints", () => {
    const error = {
      code: "23505",
      constraint: "identity_link_redirect_sessions_state_uidx",
    };

    expect(
      isControlPlaneUniqueViolation(
        error,
        ControlPlaneConstraintIds.SANDBOX_PROFILE_VERSIONS_ONE_DRAFT_PER_PROFILE,
      ),
    ).toBe(false);
  });
});
