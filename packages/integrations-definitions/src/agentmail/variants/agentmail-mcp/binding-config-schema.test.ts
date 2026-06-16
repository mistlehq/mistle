import { describe, expect, it } from "vitest";

import { AgentMailBindingConfigSchema } from "./binding-config-schema.js";

describe("AgentMailBindingConfigSchema", () => {
  it("defaults optional tool selections to AgentMail MCP", () => {
    expect(AgentMailBindingConfigSchema.parse({})).toEqual({
      tools: ["agentmail-mcp"],
    });
  });

  it("rejects unknown tool identifiers", () => {
    expect(() =>
      AgentMailBindingConfigSchema.parse({
        tools: ["agentmail-api"],
      }),
    ).toThrow(/Invalid input/u);
  });
});
