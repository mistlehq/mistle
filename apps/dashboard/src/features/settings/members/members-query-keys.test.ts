import { describe, expect, it } from "vitest";

import { buildMembersQueryKeys } from "./members-query-keys.js";

describe("buildMembersQueryKeys", () => {
  it("builds members settings query keys for an organization", () => {
    const keys = buildMembersQueryKeys("org_123");

    expect(keys).toEqual({
      members: ["settings", "members", "org_123"],
      invitations: ["settings", "invitations", "org_123"],
      capabilities: ["settings", "membership-capabilities", "org_123"],
    });
  });
});
