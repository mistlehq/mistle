import { describe, expect, it } from "vitest";

import { CodexComposerCapabilities } from "./composer-capabilities.js";

describe("Codex composer capabilities", () => {
  it("exposes review, plan, goal, and compact slash commands", () => {
    const commandCapability = CodexComposerCapabilities.find(
      (capability) => capability.kind === "composerCommand",
    );

    expect(commandCapability?.commands).toEqual([
      {
        id: "codex.review",
        name: "review",
        description: "Review the current changes",
        submitAs: "inlineText",
      },
      {
        id: "codex.plan",
        name: "plan",
        description: "Plan before making changes",
        submitAs: "inlineText",
      },
      {
        id: "codex.goal",
        name: "goal",
        description: "Set or update the current goal",
        submitAs: "inlineText",
      },
      {
        id: "codex.compact",
        name: "compact",
        description: "Compact the current context",
        submitAs: "runtimeCommand",
      },
    ]);
  });
});
