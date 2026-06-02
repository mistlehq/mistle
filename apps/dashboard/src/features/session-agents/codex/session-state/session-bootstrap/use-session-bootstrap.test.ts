import { describe, expect, it } from "vitest";

import { StaleConnectionAttemptError } from "../session-connection/codex-session-errors.js";
import {
  ensureCurrentThreadSyncGeneration,
  resolveEnabledSkillMentions,
} from "./use-session-bootstrap.js";

describe("resolveEnabledSkillMentions", () => {
  it("exposes enabled Codex skills as composer mentions", () => {
    expect(
      resolveEnabledSkillMentions({
        cwd: "/repo",
        entries: [
          {
            cwd: "/repo",
            skills: [
              {
                name: "grill-with-docs",
                description: "Stress test a plan against docs",
                shortDescription: "Grill docs",
                path: "/home/.codex/skills/grill-with-docs/SKILL.md",
                enabled: true,
              },
              {
                name: "disabled-skill",
                description: "Disabled skill",
                shortDescription: null,
                path: "/home/.codex/skills/disabled-skill/SKILL.md",
                enabled: false,
              },
            ],
            errors: [],
          },
        ],
      }),
    ).toEqual([
      {
        name: "grill-with-docs",
        description: "Grill docs",
        sourcePath: "/home/.codex/skills/grill-with-docs/SKILL.md",
      },
    ]);
  });
});

describe("ensureCurrentThreadSyncGeneration", () => {
  it("allows the active thread sync generation to continue", () => {
    expect(() => {
      ensureCurrentThreadSyncGeneration({
        currentGeneration: 3,
        expectedGeneration: 3,
      });
    }).not.toThrow();
  });

  it("throws a stale connection attempt error when the thread sync generation is outdated", () => {
    expect(() => {
      ensureCurrentThreadSyncGeneration({
        currentGeneration: 4,
        expectedGeneration: 3,
      });
    }).toThrow(StaleConnectionAttemptError);
  });
});
