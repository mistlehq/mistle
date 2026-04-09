import { describe, expect, it } from "vitest";

import { createE2BTemplateAlias } from "./template-registry.js";

describe("createE2BTemplateAlias", () => {
  it("returns the same alias for the same base image ref", () => {
    const input = {
      baseRef: "ghcr.io/mistlehq/sandbox-base:latest",
      cpuCount: 4,
      memoryMb: 8192,
    };

    expect(createE2BTemplateAlias(input)).toBe(createE2BTemplateAlias(input));
  });

  it("returns different aliases for different base image refs", () => {
    expect(
      createE2BTemplateAlias({
        baseRef: "ghcr.io/mistlehq/sandbox-base:latest",
        cpuCount: 4,
        memoryMb: 8192,
      }),
    ).not.toBe(
      createE2BTemplateAlias({
        baseRef: "ghcr.io/mistlehq/sandbox-base:v2",
        cpuCount: 4,
        memoryMb: 8192,
      }),
    );
  });

  it("returns different aliases for different resource defaults", () => {
    expect(
      createE2BTemplateAlias({
        baseRef: "ghcr.io/mistlehq/sandbox-base:latest",
        cpuCount: 4,
        memoryMb: 8192,
      }),
    ).not.toBe(
      createE2BTemplateAlias({
        baseRef: "ghcr.io/mistlehq/sandbox-base:latest",
        cpuCount: 6,
        memoryMb: 8192,
      }),
    );
  });
});
