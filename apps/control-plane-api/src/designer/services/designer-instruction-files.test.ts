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
});

function loadCanonicalDesignerInstructionFile(fileName: string): string {
  return readFileSync(new URL(`../instructions/${fileName}`, import.meta.url), "utf8").trim();
}
