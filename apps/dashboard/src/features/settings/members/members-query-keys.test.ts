import { describe, expect, it } from "vitest";

import { buildMembersQueryKeys } from "./members-query-keys.js";

describe("buildMembersQueryKeys", () => {
  it("builds members settings query keys for an organization", () => {
    const keys = buildMembersQueryKeys("org_123");

    expect(keys).toEqual({
      directory: ["settings", "members-directory", "org_123"],
      capabilities: ["settings", "membership-capabilities", "org_123"],
    });
  });
});
