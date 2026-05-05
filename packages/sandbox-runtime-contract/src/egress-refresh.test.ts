import { describe, expect, it } from "vitest";

import { SandboxdEgressGrantRefreshInputSchema } from "./egress-refresh.js";

const RuntimePlan = {
  sandboxProfileId: "sbp_123",
  version: 1,
  image: {
    source: "base",
    imageRef: "ubuntu:24.04",
  },
  egressRoutes: [],
  artifacts: [],
  workspaceSources: [],
  runtimeClients: [],
  agentRuntimes: [],
};

describe("egress refresh contracts", () => {
  it("parses a narrow egress grant refresh input", () => {
    const input = {
      runtimePlan: RuntimePlan,
      egressGrantByRuleId: {
        egress_rule_allow_all: "grant-token",
      },
    };

    expect(SandboxdEgressGrantRefreshInputSchema.parse(input)).toEqual(input);
  });

  it("rejects unexpected top-level fields", () => {
    expect(() =>
      SandboxdEgressGrantRefreshInputSchema.parse({
        runtimePlan: RuntimePlan,
        egressGrantByRuleId: {},
        bootstrapToken: "not-part-of-this-control-message",
      }),
    ).toThrow("Unrecognized key");
  });
});
