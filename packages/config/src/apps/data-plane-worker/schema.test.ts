import { describe, expect, it } from "vitest";

import {
  DataPlaneWorkerSandboxConfigSchema,
  getDataPlaneWorkerSandboxProviderValidationIssue,
} from "./schema.js";

describe("DataPlaneWorkerSandboxConfigSchema", () => {
  it("defaults the E2B domain to the hosted cloud domain", () => {
    const parsed = DataPlaneWorkerSandboxConfigSchema.parse({
      tokenizerProxyEgressBaseUrl: "http://127.0.0.1:5004/tokenizer-proxy/egress",
      e2b: {
        apiKey: "test-api-key",
      },
    });

    expect(parsed).toEqual({
      tokenizerProxyEgressBaseUrl: "http://127.0.0.1:5004/tokenizer-proxy/egress",
      e2b: {
        apiKey: "test-api-key",
        domain: "e2b.app",
      },
    });
  });

  it("parses E2B sandbox settings", () => {
    const parsed = DataPlaneWorkerSandboxConfigSchema.parse({
      tokenizerProxyEgressBaseUrl: "http://127.0.0.1:5004/tokenizer-proxy/egress",
      e2b: {
        apiKey: "test-api-key",
        domain: "e2b.example.com",
      },
    });

    expect(parsed).toEqual({
      tokenizerProxyEgressBaseUrl: "http://127.0.0.1:5004/tokenizer-proxy/egress",
      e2b: {
        apiKey: "test-api-key",
        domain: "e2b.example.com",
      },
    });
  });
});

describe("getDataPlaneWorkerSandboxProviderValidationIssue", () => {
  it("requires E2B settings when the global provider is e2b", () => {
    const issue = getDataPlaneWorkerSandboxProviderValidationIssue({
      globalSandboxProvider: "e2b",
      appSandbox: {
        tokenizerProxyEgressBaseUrl: "http://127.0.0.1:5004/tokenizer-proxy/egress",
      },
    });

    expect(issue).toEqual({
      path: ["sandbox", "e2b"],
      message:
        "apps.data_plane_worker.sandbox.e2b is required when global.sandbox.provider is 'e2b'.",
    });
  });
});
