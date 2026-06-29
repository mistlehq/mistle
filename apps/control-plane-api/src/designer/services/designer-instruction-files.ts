import { readFileSync } from "node:fs";

const DesignerInstructionFileNames = {
  CONTEXT: "designer-context.md",
  BEHAVIOR: "designer-behavior.md",
} as const;

type DesignerInstructionFileName =
  (typeof DesignerInstructionFileNames)[keyof typeof DesignerInstructionFileNames];

export function loadDesignerInstructionContent(fileName: DesignerInstructionFileName): string {
  const content = readFileSync(new URL(`../instructions/${fileName}`, import.meta.url), "utf8");
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    throw new Error(`Designer instruction file '${fileName}' must not be empty.`);
  }

  return trimmed;
}
