import { describe, expect, it } from "vitest";

import { loadGlobalFromEnv } from "./load-env.js";

describe("loadGlobalFromEnv", () => {
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
