import { describe, expect, it } from "vitest";

import {
  resolveScaffoldProfileDisplayName,
  SANDBOX_PROFILE_SCAFFOLD_ROWS,
} from "./scaffold-profiles.js";

describe("scaffold profiles", () => {
  it("exposes stable scaffold rows", () => {
    expect(SANDBOX_PROFILE_SCAFFOLD_ROWS).toEqual([
      {
        id: "sandboxProfile_scaffold_active",
        displayName: "Default profile",
        status: "Active",
        model: "openai",
        executables: "2 enabled",
        triggers: "2 rules",
        updated: "2026-02-25T11:04:00Z",
      },
      {
        id: "sandboxProfile_scaffold_inactive",
        displayName: "Repository sync profile",
        status: "Inactive",
        model: "Unbound",
        executables: "0 enabled",
        triggers: "0 rules",
        updated: "2026-02-24T19:20:00Z",
      },
    ]);
  });

  it("resolves scaffold display name by id", () => {
    expect(resolveScaffoldProfileDisplayName("sandboxProfile_scaffold_active")).toBe(
      "Default profile",
    );
    expect(resolveScaffoldProfileDisplayName("missing")).toBeNull();
  });
});
