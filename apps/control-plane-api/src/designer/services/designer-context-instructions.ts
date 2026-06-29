import type { MistleManagedInstructionBlock } from "@mistle/integrations-definitions/agent-runtimes/codex";

import { loadDesignerInstructionContent } from "./designer-instruction-files.js";

export function createDesignerContextInstructionBlock(): MistleManagedInstructionBlock {
  return {
    blockId: "mistle-designer-context",
    content: loadDesignerInstructionContent("designer-context.md"),
  };
}
