import { describe, expect, it } from "vitest";

import {
  buildOtlpHttpExporterConfig,
  parseOtlpHeadersJson,
  parseOtlpResourceAttributes,
} from "./otlp-config.js";

describe("buildOtlpHttpExporterConfig", () => {
  it("preserves configured HTTP headers", () => {
    expect(
      buildOtlpHttpExporterConfig({
        endpoint: "http://127.0.0.1:4318/v1/logs",
        headers: {
          authorization: "Bearer token",
          "x-scope-orgid": "tenant",
        },
      }),
    ).toEqual({
      url: "http://127.0.0.1:4318/v1/logs",
      headers: {
        authorization: "Bearer token",
        "x-scope-orgid": "tenant",
      },
    });
  });
});

describe("parseOtlpHeadersJson", () => {
  it("parses a JSON object of string header values", () => {
    expect(
      parseOtlpHeadersJson({
        envName: "MISTLE_GLOBAL_TELEMETRY_LOGS_HEADERS_JSON",
        rawValue: '{"authorization":"Bearer token","x-scope-orgid":"tenant"}',
      }),
    ).toEqual({
      authorization: "Bearer token",
      "x-scope-orgid": "tenant",
    });
  });

  it("fails for non-string header values", () => {
    expect(() =>
      parseOtlpHeadersJson({
        envName: "MISTLE_GLOBAL_TELEMETRY_LOGS_HEADERS_JSON",
        rawValue: '{"authorization":1}',
      }),
    ).toThrow(
      "Invalid MISTLE_GLOBAL_TELEMETRY_LOGS_HEADERS_JSON: header 'authorization' must be a string.",
    );
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
