import { describe, expect, it } from "vitest";

import {
  isPostgresConstraintError,
  isPostgresUniqueConstraintError,
  PostgresSqlStateCodes,
} from "./postgres-errors.js";

describe("postgres errors", () => {
  it("matches direct constraint errors", () => {
    const error = {
      code: PostgresSqlStateCodes.UNIQUE_VIOLATION,
      constraint: "sandbox_profile_versions_one_draft_per_profile_uidx",
    };

    expect(
      isPostgresUniqueConstraintError(error, "sandbox_profile_versions_one_draft_per_profile_uidx"),
    ).toBe(true);
  });

  it("matches constraint errors nested under cause", () => {
    const error = {
      cause: {
        code: PostgresSqlStateCodes.UNIQUE_VIOLATION,
        constraint: "sandbox_profile_versions_pkey",
      },
    };

    expect(isPostgresUniqueConstraintError(error, "sandbox_profile_versions_pkey")).toBe(true);
  });

  it("returns false for non-matching SQLSTATE or constraint values", () => {
    const error = {
      code: "23503",
      constraint: "sandbox_profile_versions_one_draft_per_profile_uidx",
    };

    expect(
      isPostgresConstraintError(error, {
        code: PostgresSqlStateCodes.UNIQUE_VIOLATION,
        constraint: "sandbox_profile_versions_one_draft_per_profile_uidx",
      }),
    ).toBe(false);
    expect(
      isPostgresUniqueConstraintError(error, "sandbox_profile_versions_one_draft_per_profile_uidx"),
    ).toBe(false);
  });
});
