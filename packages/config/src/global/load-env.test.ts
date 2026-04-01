import { describe, expect, it } from "vitest";

import { loadGlobalFromEnv } from "./load-env.js";

describe("loadGlobalFromEnv", () => {
  it("loads telemetry header JSON from env", () => {
    expect(
      loadGlobalFromEnv({
        MISTLE_GLOBAL_TELEMETRY_LOGS_HEADERS_JSON:
          '{"authorization":"Bearer token","x-scope-orgid":"tenant-a"}',
      }),
    ).toEqual({
      telemetry: {
        logs: {
          headers: {
            authorization: "Bearer token",
            "x-scope-orgid": "tenant-a",
          },
        },
      },
    });
  });

  it("fails fast for invalid telemetry header JSON", () => {
    expect(() =>
      loadGlobalFromEnv({
        MISTLE_GLOBAL_TELEMETRY_LOGS_HEADERS_JSON: '{"authorization":1}',
      }),
    ).toThrow(
      "Invalid MISTLE_GLOBAL_TELEMETRY_LOGS_HEADERS_JSON: Invalid value for header 'authorization'. Expected a string.",
    );
  });

  it("loads sandbox egress token config from env", () => {
    const loaded = loadGlobalFromEnv({
      MISTLE_GLOBAL_SANDBOX_EGRESS_TOKEN_SECRET: "egress-secret",
      MISTLE_GLOBAL_SANDBOX_EGRESS_TOKEN_ISSUER: "data-plane-worker",
      MISTLE_GLOBAL_SANDBOX_EGRESS_TOKEN_AUDIENCE: "tokenizer-proxy",
    });

    expect(loaded).toEqual({
      sandbox: {
        egress: {
          tokenSecret: "egress-secret",
          tokenIssuer: "data-plane-worker",
          tokenAudience: "tokenizer-proxy",
        },
      },
    });
  });

  it("omits sandbox config when no sandbox env vars are present", () => {
    expect(loadGlobalFromEnv({})).toEqual({});
  });
});
