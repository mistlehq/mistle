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

  it("keeps the behavior instruction structure explicit", () => {
    const behaviorInstructions = loadDesignerInstructionContent("designer-behavior.md");

    expect(getSectionHeadings(behaviorInstructions)).toEqual([
      "## Default Flow",
      "## Alignment",
      "## Configuration Dependencies",
      "## Decision Requests",
      "## Workflow Blueprint Rules",
      "## Workflow References",
      "## Product And Canvas Rules",
      "## Run Actions",
      "## Integration Setup",
      "## Tools And Evidence",
      "## Authority And Safety",
      "## Communication",
    ]);
  });

  it("keeps required behavior sections connected to their core terms", () => {
    const behaviorInstructions = loadDesignerInstructionContent("designer-behavior.md");

    expect(getSection(behaviorInstructions, "## Alignment")).toContain("Workflow");
    expect(getSection(behaviorInstructions, "## Alignment")).toContain("configuration change");
    expect(getSection(behaviorInstructions, "## Alignment")).toContain("Run action");
    expect(getSection(behaviorInstructions, "## Alignment")).toContain(
      "not as alignment by itself",
    );
    expect(getSection(behaviorInstructions, "## Alignment")).toContain("comments on the blueprint");
    expect(getSection(behaviorInstructions, "## Configuration Dependencies")).toContain(
      "App setup",
    );
    expect(getSection(behaviorInstructions, "## Configuration Dependencies")).toContain(
      "provider tools",
    );
    expect(getSection(behaviorInstructions, "## Configuration Dependencies")).toContain(
      "publishing",
    );
    expect(getSection(behaviorInstructions, "## Configuration Dependencies")).toContain("triggers");
    expect(getSection(behaviorInstructions, "## Product And Canvas Rules")).toContain(
      "Agent model provider",
    );
    expect(getSection(behaviorInstructions, "## Product And Canvas Rules")).toContain(
      'agentRuntimeId: "codex"',
    );
    expect(getSection(behaviorInstructions, "## Integration Setup")).toContain('kind: "agent"');
    expect(getSection(behaviorInstructions, "## Decision Requests")).toContain(
      "dashboard decision request",
    );
    expect(getSection(behaviorInstructions, "## Decision Requests")).toContain(
      "Do not use a dashboard decision request just to ask whether the blueprint is accepted",
    );
    expect(getSection(behaviorInstructions, "## Workflow Blueprint Rules")).toContain(
      "Workflow blueprint",
    );
    expect(getSection(behaviorInstructions, "## Integration Setup")).not.toContain(
      "For GitHub webhook payload fields",
    );
    expect(behaviorInstructions).not.toContain("directionally clear");
  });

  it("keeps workflow-family implementation rules out of always-loaded behavior instructions", () => {
    const behaviorInstructions = loadDesignerInstructionContent("designer-behavior.md");
    const workflowReferencesSection = getSection(behaviorInstructions, "## Workflow References");

    expect(workflowReferencesSection).toContain(
      ".mistle/designer/references/workflow-patterns/ai-software-factory.md",
    );
    expect(workflowReferencesSection).not.toContain("Linear-backed");
    expect(workflowReferencesSection).not.toContain("Implementation agent instructions");
    expect(workflowReferencesSection).not.toContain("Review agent instructions");
    expect(workflowReferencesSection).not.toContain("PR proposal");
    expect(workflowReferencesSection).not.toContain("6-8");
  });

  it("keeps the context vocabulary structure explicit", () => {
    const contextInstructions = loadDesignerInstructionContent("designer-context.md");

    expect(getBoldTermHeadings(contextInstructions)).toEqual([
      "**Workflow outcome**:",
      "**Workflow**:",
      "**Workflow blueprint**:",
      "**Trigger**:",
      "**Agent step**:",
      "**Agent output**:",
      "**App**:",
      "**Connected app**:",
      "**Mistle resource access**:",
      "**Provider tool**:",
      "**Agent model provider**:",
      "**Agent**:",
      "**Task**:",
      "**Approval boundary**:",
      "**Sandbox profile**:",
      "**Configuration change**:",
      "**User action**:",
      "**App setup**:",
      "**Publish the profile version**:",
      "**Create a trigger**:",
      "**Enable a trigger**:",
      "**Run action**:",
      "**Start a session**:",
    ]);
  });

  it("keeps approval and action vocabulary separated", () => {
    const contextInstructions = loadDesignerInstructionContent("designer-context.md");
    const behaviorInstructions = loadDesignerInstructionContent("designer-behavior.md");

    expect(getTermBlock(contextInstructions, "**Approval boundary**:")).toContain(
      "Workflow behavior",
    );
    expect(getTermBlock(contextInstructions, "**Approval boundary**:")).toContain(
      "Run action approval",
    );
    expect(getTermBlock(contextInstructions, "**Configuration change**:")).toContain(
      "Designer- or product-side",
    );
    expect(getTermBlock(contextInstructions, "**Agent model provider**:")).toContain(
      'kind: "agent"',
    );
    expect(getTermBlock(contextInstructions, "**Agent model provider**:")).toContain(
      'agentRuntimeId: "codex"',
    );
    expect(getTermBlock(contextInstructions, "**User action**:")).toContain(
      "outside Designer's available tools",
    );
    expect(getTermBlock(contextInstructions, "**Run action**:")).toContain(
      "without changing configuration",
    );
    expect(behaviorInstructions).not.toContain("runtime approval boundary");
    expect(behaviorInstructions).not.toContain("human follow-up");
    expect(behaviorInstructions).not.toContain("At handoff");
  });

  it("keeps Run action support boundaries explicit without relying on exact prose", () => {
    const contextInstructions = loadDesignerInstructionContent("designer-context.md");
    const behaviorInstructions = loadDesignerInstructionContent("designer-behavior.md");

    expect(getTermBlock(contextInstructions, "**Run action**:")).toContain("Start a session");
    expect(getTermBlock(contextInstructions, "**Run action**:")).toContain("Simulating a trigger");
    expect(getSection(behaviorInstructions, "## Run Actions")).toContain("Start a session");
    expect(getSection(behaviorInstructions, "## Run Actions")).toContain(
      "Simulated trigger execution",
    );
    expect(getSection(behaviorInstructions, "## Run Actions")).toContain("product tool");
  });
});

function loadCanonicalDesignerInstructionFile(fileName: string): string {
  return readFileSync(new URL(`../instructions/${fileName}`, import.meta.url), "utf8").trim();
}

function getSection(content: string, heading: string): string {
  const sectionStart = content.indexOf(heading);
  expect(sectionStart).toBeGreaterThanOrEqual(0);

  const nextSectionStart = content.indexOf("\n## ", sectionStart + heading.length);
  if (nextSectionStart === -1) {
    return content.slice(sectionStart);
  }

  return content.slice(sectionStart, nextSectionStart);
}

function getSectionHeadings(content: string): string[] {
  return content
    .split("\n")
    .filter((line) => line.startsWith("## "))
    .map((line) => line.trim());
}

function getBoldTermHeadings(content: string): string[] {
  return content
    .split("\n")
    .filter((line) => line.startsWith("**") && line.endsWith(":"))
    .map((line) => line.trim());
}

function getTermBlock(content: string, termHeading: string): string {
  const termStart = content.indexOf(termHeading);
  expect(termStart).toBeGreaterThanOrEqual(0);

  const nextTermStart = content.indexOf("\n**", termStart + termHeading.length);
  const nextSectionStart = content.indexOf("\n## ", termStart + termHeading.length);
  const candidates = [nextTermStart, nextSectionStart].filter((index) => index !== -1);

  if (candidates.length === 0) {
    return content.slice(termStart);
  }

  return content.slice(termStart, Math.min(...candidates));
}
