import { describe, expect, it } from "vitest";

import { AgentMailTargetConfigSchema } from "./target-config-schema.js";
import { AgentMailTargetSecretSchema } from "./target-secret-schema.js";

describe("AgentMail target schemas", () => {
  it("accepts empty target config and target secrets", () => {
    expect(AgentMailTargetConfigSchema.parse({})).toEqual({});
    expect(AgentMailTargetSecretSchema.parse({})).toEqual({});
  });

  it("rejects unexpected target config and secret fields", () => {
    expect(() => AgentMailTargetConfigSchema.parse({ unexpected: true })).toThrow(
      /Unrecognized key/u,
    );
    expect(() => AgentMailTargetSecretSchema.parse({ unexpected: "value" })).toThrow(
      /Unrecognized key/u,
    );
  });
});
