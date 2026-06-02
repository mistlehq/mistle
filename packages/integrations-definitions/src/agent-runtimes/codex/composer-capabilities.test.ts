import type { ComposerCapability } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import {
  CodexComposerCapabilities,
  resolveCodexComposerCapabilities,
} from "./composer-capabilities.js";

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
        availability: {
          duringActiveTurn: "disabled",
        },
        submitAs: "typedRuntimeCommand",
      },
      {
        id: "codex.plan",
        name: "plan",
        description: "Plan before making changes",
        availability: {
          duringActiveTurn: "disabled",
        },
        submitAs: "typedRuntimeCommand",
      },
      {
        id: "codex.goal",
        name: "goal",
        description: "Set or update the current goal",
        availability: {
          duringActiveTurn: "enabled",
        },
        submitAs: "typedRuntimeCommand",
      },
      {
        id: "codex.compact",
        name: "compact",
        description: "Compact the current context",
        availability: {
          duringActiveTurn: "disabled",
        },
        submitAs: "runtimeCommand",
      },
    ]);
  });

  it("filters goal slash command when Codex goals are disabled", () => {
    expect(listCommandNames(resolveCodexComposerCapabilities({ goalsEnabled: false }))).toEqual([
      "review",
      "plan",
      "compact",
    ]);
  });

  it("keeps goal and compact slash commands when Codex goals are enabled", () => {
    expect(listCommandNames(resolveCodexComposerCapabilities({ goalsEnabled: true }))).toEqual([
      "review",
      "plan",
      "goal",
      "compact",
    ]);
  });

  it("adds runtime-discovered skill mentions when skills are supplied", () => {
    expect(
      resolveCodexComposerCapabilities({
        goalsEnabled: true,
        skills: [
          {
            name: "grill-with-docs",
            description: "Stress test a plan against docs",
            sourcePath: "/root/.codex/skills/grill-with-docs/SKILL.md",
          },
        ],
      }).find((capability) => capability.kind === "skillMention"),
    ).toEqual({
      kind: "skillMention",
      trigger: "$",
      source: "runtimeSkill",
      submitAs: "inlineText",
      skills: [
        {
          name: "grill-with-docs",
          description: "Stress test a plan against docs",
          sourcePath: "/root/.codex/skills/grill-with-docs/SKILL.md",
        },
      ],
    });
  });
});

function listCommandNames(capabilities: readonly ComposerCapability[]): string[] {
  const commandCapability = capabilities.find(
    (capability) => capability.kind === "composerCommand",
  );
  return commandCapability?.commands.map((command) => command.name) ?? [];
}
