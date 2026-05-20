import { describe, expect, it } from "vitest";

import {
  buildOpenCodePromptCommandId,
  isOpenCodePromptCommandId,
  mapOpenCodePromptCommandsToComposerCapabilities,
  shouldExposeOpenCodePromptCommand,
} from "./composer-capabilities.js";

describe("OpenCode composer capabilities", () => {
  it("maps visible OpenCode prompt commands to typed runtime composer commands", () => {
    expect(buildOpenCodePromptCommandId("review")).toBe("opencode.prompt.review");
    expect(isOpenCodePromptCommandId("opencode.prompt.review")).toBe(true);
    expect(isOpenCodePromptCommandId("codex.review")).toBe(false);
    expect(
      mapOpenCodePromptCommandsToComposerCapabilities([
        {
          name: "review",
          description: "review changes",
        },
        {
          name: "mcp-prompt",
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
    expect(shouldExposeOpenCodePromptCommand({ name: "customize-opencode" })).toBe(false);
    expect(
      mapOpenCodePromptCommandsToComposerCapabilities([{ name: "customize-opencode" }]),
    ).toEqual([]);
  });
});
