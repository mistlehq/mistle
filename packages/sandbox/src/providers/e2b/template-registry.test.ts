import { describe, expect, it } from "vitest";

import { createE2BTemplateAlias } from "./template-registry.js";

describe("createE2BTemplateAlias", () => {
  it("returns the same alias for the same base image ref", () => {
    const input = {
      baseRef: "ghcr.io/mistlehq/sandbox-base:latest",
      cpuCount: 2,
      memoryMb: 4096,
    };

    expect(createE2BTemplateAlias(input)).toBe(createE2BTemplateAlias(input));
  });

  it("returns different aliases for different base image refs", () => {
    expect(
      createE2BTemplateAlias({
        baseRef: "ghcr.io/mistlehq/sandbox-base:latest",
        cpuCount: 2,
        memoryMb: 4096,
      }),
    ).not.toBe(
      createE2BTemplateAlias({
        baseRef: "ghcr.io/mistlehq/sandbox-base:v2",
        cpuCount: 2,
        memoryMb: 4096,
      }),
    );
  });

  it("returns different aliases for different resource defaults", () => {
    expect(
      createE2BTemplateAlias({
        baseRef: "ghcr.io/mistlehq/sandbox-base:latest",
        cpuCount: 2,
        memoryMb: 4096,
      }),
    ).not.toBe(
      createE2BTemplateAlias({
        baseRef: "ghcr.io/mistlehq/sandbox-base:latest",
        cpuCount: 6,
        memoryMb: 4096,
      }),
    );
  });
});
