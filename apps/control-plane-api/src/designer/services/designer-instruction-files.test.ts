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
      "Use Workflow references for domain behavior, operating constraints, and expected responsibilities. Use the Workflow Blueprint Rules section for blueprint schema, rendering, and field-selection rules.",
    );
    expect(behaviorInstructions).toContain(
      "Whenever you first show or later update a Workflow blueprint, describe the same flow in chat as concise point form",
    );
    expect(behaviorInstructions).toContain(
      "When updating an existing Workflow blueprint, first state what changed from the previous version",
    );
  });

  it("defines Alignment as the gate before configuration changes and Run actions", () => {
    const behaviorInstructions = loadDesignerInstructionContent("designer-behavior.md");

    expect(behaviorInstructions).toContain("## Alignment");
    expect(behaviorInstructions).toContain(
      "Alignment means Designer has enough shared understanding of the Workflow or Workflow change",
    );
    expect(behaviorInstructions).toContain(
      "Ask only for decisions that affect Workflow behavior, configuration changes, approval boundaries, provider setup, trigger behavior, selected resources, or Run actions.",
    );
    expect(behaviorInstructions).toContain(
      "When updating an existing Agent, trigger, or setup, infer the current Workflow from the current setup",
    );
    expect(behaviorInstructions).not.toContain("directionally clear");
  });

  it("orders configuration dependencies after alignment", () => {
    const behaviorInstructions = loadDesignerInstructionContent("designer-behavior.md");

    expect(behaviorInstructions).toContain("## Configuration Dependencies");
    expect(behaviorInstructions).toContain(
      "After the Workflow is aligned, resolve Configuration Dependencies before configuration changes or Run actions.",
    );
    expect(behaviorInstructions).toContain(
      "Use this default order unless the current setup or user request requires a different order: Apps, Connected apps or App setup, provider resources, provider tools, Sandbox profile configuration, publishing, triggers, Run actions.",
    );
    expect(behaviorInstructions).toContain(
      "Treat App setup, resource selection, provider tool selection, publishing, and triggers as dependencies of the aligned Workflow, not standalone setup prompts.",
    );
  });

  it("defines approval boundaries separately from Designer configuration approval", () => {
    const contextInstructions = loadDesignerInstructionContent("designer-context.md");
    const behaviorInstructions = loadDesignerInstructionContent("designer-behavior.md");

    expect(contextInstructions).toContain("**Approval boundary**:");
    expect(contextInstructions).toContain(
      "It is part of Workflow behavior, not permission for Designer to perform aligned configuration changes.",
    );
    expect(behaviorInstructions).toContain(
      "Do not use approval as a generic gate for aligned configuration changes.",
    );
    expect(behaviorInstructions).toContain(
      "Use approval boundary for Workflow behavior and Run action approval for starting or testing the Workflow.",
    );
    expect(behaviorInstructions).not.toContain("runtime approval boundary");
  });

  it("treats aligned configuration changes as approved by alignment", () => {
    const contextInstructions = loadDesignerInstructionContent("designer-context.md");
    const behaviorInstructions = loadDesignerInstructionContent("designer-behavior.md");

    expect(contextInstructions).toContain(
      "Create a published **Sandbox profile version** from the reviewed **Sandbox profile version configuration** after alignment.",
    );
    expect(contextInstructions).toContain(
      "Create a new trigger record for the workflow after alignment.",
    );
    expect(behaviorInstructions).toContain(
      "Do not ask for separate approval before aligned configuration changes.",
    );
    expect(behaviorInstructions).toContain(
      "Request explicit approval only before Run actions such as starting sessions or simulating trigger runs.",
    );
    expect(behaviorInstructions).not.toContain("explicit approval before publishing");
    expect(behaviorInstructions).not.toContain("explicit approval before creating triggers");
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
