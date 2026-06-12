import { describe, expect, it } from "vitest";

import {
  buildPiCommandId,
  isPiCommandId,
  mapPiCommandsToComposerCapabilities,
  readPiCommandSourceFromId,
} from "./composer-capabilities.js";

describe("Pi composer capabilities", () => {
  it("maps Pi commands to runtime composer commands with source-specific ids", () => {
    expect(
      mapPiCommandsToComposerCapabilities([
        {
          name: "review",
          description: "Review the current diff",
          source: "prompt",
        },
        {
          name: "skill:frontend",
          source: "skill",
        },
        {
          name: "sync-linear",
          source: "extension",
        },
      ]),
    ).toEqual([
      {
        kind: "composerCommand",
        trigger: "/",
        source: "runtimeCommand",
        commands: [
          {
            id: "pi.prompt.review",
            name: "review",
            description: "Review the current diff",
            availability: {
              duringActiveTurn: "enabled",
            },
            submitAs: "typedRuntimeCommand",
          },
          {
            id: "pi.skill.skill:frontend",
            name: "skill:frontend",
            availability: {
              duringActiveTurn: "enabled",
            },
            submitAs: "typedRuntimeCommand",
          },
          {
            id: "pi.extension.sync-linear",
            name: "sync-linear",
            availability: {
              duringActiveTurn: "disabled",
            },
            submitAs: "typedRuntimeCommand",
          },
        ],
      },
    ]);
  });

  it("reads the Pi command source from composer command ids", () => {
    expect(buildPiCommandId({ name: "review", source: "prompt" })).toBe("pi.prompt.review");
    expect(readPiCommandSourceFromId("pi.prompt.review")).toBe("prompt");
    expect(readPiCommandSourceFromId("pi.skill.skill:frontend")).toBe("skill");
    expect(readPiCommandSourceFromId("pi.extension.sync-linear")).toBe("extension");
    expect(readPiCommandSourceFromId("codex.plan")).toBeNull();
    expect(isPiCommandId("pi.prompt.review")).toBe(true);
    expect(isPiCommandId("opencode.prompt.review")).toBe(false);
  });
});
