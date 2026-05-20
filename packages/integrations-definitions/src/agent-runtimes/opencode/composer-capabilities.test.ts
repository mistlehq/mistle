import { describe, expect, it } from "vitest";

import {
  buildOpenCodePromptCommandId,
  mapOpenCodePromptCommandsToComposerCapabilities,
  shouldExposeOpenCodePromptCommand,
} from "./composer-capabilities.js";

describe("OpenCode composer capabilities", () => {
  it("maps visible OpenCode prompt commands to typed runtime composer commands", () => {
    expect(buildOpenCodePromptCommandId("review")).toBe("opencode.prompt.review");
    expect(
      mapOpenCodePromptCommandsToComposerCapabilities([
        {
          name: "review",
          description: "review changes",
          source: "command",
          template: "Review $ARGUMENTS",
          hints: ["$ARGUMENTS"],
        },
        {
          name: "mcp-prompt",
          source: "mcp",
          template: "Run MCP prompt",
          hints: [],
        },
      ]),
    ).toEqual([
      {
        kind: "composerCommand",
        trigger: "/",
        source: "runtimeCommand",
        commands: [
          {
            id: "opencode.prompt.review",
            name: "review",
            description: "review changes",
            availability: {
              duringActiveTurn: "disabled",
            },
            submitAs: "typedRuntimeCommand",
          },
          {
            id: "opencode.prompt.mcp-prompt",
            name: "mcp-prompt",
            availability: {
              duringActiveTurn: "disabled",
            },
            submitAs: "typedRuntimeCommand",
          },
        ],
      },
    ]);
  });

  it("omits the built-in customize-opencode skill from Mistle composer commands", () => {
    const hiddenCommand = {
      name: "customize-opencode",
      description: "customize opencode config",
      source: "skill" as const,
      template: "Customize opencode",
      hints: [],
    };

    expect(shouldExposeOpenCodePromptCommand(hiddenCommand)).toBe(false);
    expect(mapOpenCodePromptCommandsToComposerCapabilities([hiddenCommand])).toEqual([]);
  });
});
