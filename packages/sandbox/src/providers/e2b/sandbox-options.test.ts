import { describe, expect, it } from "vitest";

import {
  createE2BRequestOptions,
  createE2BSandboxConnectOptions,
  createE2BSandboxCreateOptions,
  E2BHobbySandboxTimeoutMs,
} from "./sandbox-options.js";

describe("createE2BRequestOptions", () => {
  it("passes through the caller supplied E2B request timeout", () => {
    const options = createE2BRequestOptions(
      {
        apiKey: "test-api-key",
        domain: "e2b.example.com",
      },
      5 * 60 * 1000,
    );

    expect(options).toEqual({
      apiKey: "test-api-key",
      domain: "e2b.example.com",
      requestTimeoutMs: 5 * 60 * 1000,
    });
  });

  it("uses the SDK request timeout behavior when the caller does not supply a timeout", () => {
    const options = createE2BRequestOptions(
      {
        apiKey: "test-api-key",
        domain: "e2b.example.com",
      },
      undefined,
    );

    expect(options).toEqual({
      apiKey: "test-api-key",
      domain: "e2b.example.com",
    });
  });

  it("overrides any existing connection request timeout with the caller supplied value", () => {
    const options = createE2BRequestOptions(
      {
        apiKey: "test-api-key",
        requestTimeoutMs: 60_000,
      },
      5 * 60 * 1000,
    );

    expect(options).toEqual({
      apiKey: "test-api-key",
      requestTimeoutMs: 5 * 60 * 1000,
    });
  });
});

describe("createE2BSandboxCreateOptions", () => {
  it("uses the explicit hobby timeout and pause lifecycle", () => {
    const options = createE2BSandboxCreateOptions({
      connectionOptions: {
        apiKey: "test-api-key",
        domain: "e2b.example.com",
      },
      templateAlias: "mistle-sandbox-base-123",
      envs: {
        FOO: "bar",
      },
    });

    expect(options).toEqual({
      apiKey: "test-api-key",
      domain: "e2b.example.com",
      timeoutMs: E2BHobbySandboxTimeoutMs,
      lifecycle: {
        onTimeout: "pause",
      },
      metadata: {
        mistle_template_alias: "mistle-sandbox-base-123",
      },
      envs: {
        FOO: "bar",
      },
    });
  });
});

describe("createE2BSandboxConnectOptions", () => {
  it("extends the sandbox ttl to the explicit hobby timeout", () => {
    const options = createE2BSandboxConnectOptions({
      apiKey: "test-api-key",
      domain: "e2b.example.com",
    });

    expect(options).toEqual({
      apiKey: "test-api-key",
      domain: "e2b.example.com",
      timeoutMs: E2BHobbySandboxTimeoutMs,
    });
  });
});
