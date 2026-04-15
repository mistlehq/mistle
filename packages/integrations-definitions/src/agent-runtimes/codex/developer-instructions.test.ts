import { describe, expect, it } from "vitest";

import { composeCodexDeveloperInstructions } from "./developer-instructions.js";

describe("composeCodexDeveloperInstructions", () => {
  it("returns only the managed sandbox context when no extra instructions are provided", () => {
    expect(
      composeCodexDeveloperInstructions({
        bindingAdditionalInstructions: null,
        automationInstructions: null,
      }),
    ).toContain("Mistle-managed sandbox context:");
  });

  it("appends binding and automation instructions in separate sections", () => {
    const instructions = composeCodexDeveloperInstructions({
      bindingAdditionalInstructions: "Prefer concise answers.",
      automationInstructions: "Always include the automation marker.",
    });

    expect(instructions).toContain("User-provided additional instructions:");
    expect(instructions).toContain("Prefer concise answers.");
    expect(instructions).toContain("Automation-specific instructions:");
    expect(instructions).toContain("Always include the automation marker.");
  });
});
