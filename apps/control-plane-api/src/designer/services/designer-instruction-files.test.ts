import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { createDesignerBehaviorInstructionBlock } from "./designer-behavior-instructions.js";
import { createDesignerContextInstructionBlock } from "./designer-context-instructions.js";
import { loadDesignerInstructionContent } from "./designer-instruction-files.js";

describe("Designer managed instruction files", () => {
  it("loads Designer managed instructions from the canonical Markdown files", () => {
    expect(createDesignerContextInstructionBlock()).toEqual({
      blockId: "mistle-designer-context",
      content: loadCanonicalDesignerInstructionFile("designer-context.md"),
    });
    expect(createDesignerBehaviorInstructionBlock()).toEqual({
      blockId: "mistle-designer-behavior",
      content: loadCanonicalDesignerInstructionFile("designer-behavior.md"),
    });
  });

  it("loads known Designer instruction files as non-empty content", () => {
    expect(loadDesignerInstructionContent("designer-context.md").length).toBeGreaterThan(0);
    expect(loadDesignerInstructionContent("designer-behavior.md").length).toBeGreaterThan(0);
  });

  it("instructs Designer to pair Workflow blueprint canvas changes with readable flow text", () => {
    const behaviorInstructions = loadDesignerInstructionContent("designer-behavior.md");

    expect(behaviorInstructions).toContain(
      "Whenever you first show or later update a Workflow blueprint, describe the same flow in chat as concise point form",
    );
    expect(behaviorInstructions).toContain(
      "When updating an existing Workflow blueprint, first state what changed from the previous version",
    );
  });

  it("keeps Run actions separate from configuration and unsupported trigger simulation", () => {
    const contextInstructions = loadDesignerInstructionContent("designer-context.md");
    const behaviorInstructions = loadDesignerInstructionContent("designer-behavior.md");

    expect(contextInstructions).toContain("**Run action**:");
    expect(contextInstructions).toContain("Start a session is supported today");
    expect(contextInstructions).toContain(
      "Designer must not claim it can run or has run a trigger simulation unless a supplied product tool explicitly supports it",
    );
    expect(behaviorInstructions).toContain(
      "Run actions test or execute an aligned Workflow and are separate from configuration changes.",
    );
    expect(behaviorInstructions).toContain(
      "Do not claim a trigger simulation is available, startable, or complete unless a supplied product tool explicitly supports it.",
    );
  });
});

function loadCanonicalDesignerInstructionFile(fileName: string): string {
  return readFileSync(new URL(`../instructions/${fileName}`, import.meta.url), "utf8").trim();
}
