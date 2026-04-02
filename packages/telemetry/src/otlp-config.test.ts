import { describe, expect, it } from "vitest";

import { parseOtlpResourceAttributes } from "./otlp-config.js";

describe("parseOtlpResourceAttributes", () => {
  it("adds service.name and parses configured resource attributes", () => {
    expect(
      parseOtlpResourceAttributes({
        serviceName: "@mistle/data-plane-gateway",
        resourceAttributes: "deployment.environment=test,service.version=1.2.3",
      }),
    ).toEqual({
      "service.name": "@mistle/data-plane-gateway",
      "deployment.environment": "test",
      "service.version": "1.2.3",
    });
  });
});
