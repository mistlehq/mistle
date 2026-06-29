import type { MistleManagedInstructionBlock } from "@mistle/integrations-definitions/agent-runtimes/codex";

import { loadDesignerInstructionContent } from "./designer-instruction-files.js";

export function createDesignerBehaviorInstructionBlock(): MistleManagedInstructionBlock {
  return {
    blockId: "mistle-designer-behavior",
    content: loadDesignerInstructionContent("designer-behavior.md"),
  };
}
