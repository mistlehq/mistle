import { describe, expect, it } from "vitest";

import { sandboxProfileVersionSkillsSourceReposQueryKey } from "./sandbox-profiles-query-keys.js";

describe("sandbox profile query keys", () => {
  it("keys skills source repo cache entries by profile version and origin URL", () => {
    const sourceKey = sandboxProfileVersionSkillsSourceReposQueryKey({
      profileId: "sbp_query_keys",
      version: 1,
      originUrl: "https://github.com/acme/skills.git",
    });

    expect(sourceKey).toEqual([
      "sandbox-profiles",
      "skills-source-repos",
      "sbp_query_keys",
      1,
      "https://github.com/acme/skills.git",
    ]);
  });
});
