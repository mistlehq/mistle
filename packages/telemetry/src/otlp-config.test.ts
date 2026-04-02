import { describe, expect, it } from "vitest";

import { buildOtlpHttpExporterConfig, parseOtlpResourceAttributes } from "./otlp-config.js";

describe("buildOtlpHttpExporterConfig", () => {
  it("maps the configured endpoint to the OTLP HTTP exporter url", () => {
    expect(
      buildOtlpHttpExporterConfig({
        endpoint: "http://127.0.0.1:4318/v1/logs",
      }),
    ).toEqual({
      url: "http://127.0.0.1:4318/v1/logs",
    });
  });
});

describe("parseOtlpResourceAttributes", () => {
  it("adds service.name and parses configured resource attributes", () => {
    expect(
      parseOtlpResourceAttributes({
        serviceName: "@mistle/data-plane-gateway",
        resourceAttributes: "deployment.environment=test,mistle.role=gateway",
      }),
    ).toEqual({
      "service.name": "@mistle/data-plane-gateway",
      "deployment.environment": "test",
      "mistle.role": "gateway",
    });
  });
});
