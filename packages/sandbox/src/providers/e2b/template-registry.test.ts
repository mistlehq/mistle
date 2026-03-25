import { describe, expect, it } from "vitest";

import { createE2BTemplateAlias } from "./template-registry.js";

describe("createE2BTemplateAlias", () => {
  it("returns the same alias for the same base image ref", () => {
    const baseRef = "ghcr.io/mistlehq/sandbox-base:latest";

    expect(createE2BTemplateAlias(baseRef)).toBe(createE2BTemplateAlias(baseRef));
  });

  it("returns different aliases for different base image refs", () => {
    expect(createE2BTemplateAlias("ghcr.io/mistlehq/sandbox-base:latest")).not.toBe(
      createE2BTemplateAlias("ghcr.io/mistlehq/sandbox-base:v2"),
    );
  });
});
