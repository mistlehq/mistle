import { describe, expect, it } from "vitest";

import { ResendBindingConfigSchema } from "./binding-config-schema.js";
import { ResendToolIds } from "./tool-ids.js";

describe("ResendBindingConfigSchema", () => {
  it("defaults Resend MCP to selected with no default sender settings", () => {
    expect(ResendBindingConfigSchema.parse({})).toEqual({
      tools: [ResendToolIds.RESEND_MCP],
      replyToEmailAddresses: [],
    });
  });

  it("accepts optional default sender and reply-to emails", () => {
    expect(
      ResendBindingConfigSchema.parse({
        tools: [ResendToolIds.RESEND_MCP],
        senderEmailAddress: " onboarding@example.com ",
        replyToEmailAddresses: ["support@example.com"],
      }),
    ).toEqual({
      tools: [ResendToolIds.RESEND_MCP],
      senderEmailAddress: "onboarding@example.com",
      replyToEmailAddresses: ["support@example.com"],
    });
  });
});
