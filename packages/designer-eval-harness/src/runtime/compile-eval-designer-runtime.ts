import { createDesignerRuntimePlan } from "@mistle/control-plane-api/designer/runtime-plan";
import type { DesignerRuntimeMistleMcpConfig } from "@mistle/control-plane-api/designer/runtime-plan";
import type { MistleManagedInstructionBlock } from "@mistle/integrations-definitions/agent-runtimes/codex";

import type { DesignerEvalConfig } from "../config/designer-eval-config.ts";
import type { DesignerEvalSeededState } from "../types.ts";

export type CompileEvalDesignerRuntimeInput = {
  availableRepositoryHandles: readonly string[];
  config: DesignerEvalConfig;
  designerSessionId: string;
  evalControlPlaneBaseUrl?: string;
  initialPrompt: string;
  openAiProviderMode?: "platform" | "local_subscription";
  organizationId: string;
  seededState: DesignerEvalSeededState;
};

export function compileEvalDesignerRuntime(input: CompileEvalDesignerRuntimeInput) {
  return createDesignerRuntimePlan({
    additionalManagedInstructionBlocks: [
      createDesignerEvalHarnessInstructionBlock({
        availableRepositoryHandles: input.availableRepositoryHandles,
        seededState: input.seededState,
      }),
    ],
    codexCliPath: input.config.runtime.codexCliPath,
    designerSessionId: input.designerSessionId,
    imageRef: input.config.runtime.imageRef,
    initialPrompt: input.initialPrompt,
    mistleMcp: resolveEvalMistleMcpConfig(input),
    ...(input.openAiProviderMode === undefined
      ? {}
      : { openAiProviderMode: input.openAiProviderMode }),
    organizationId: input.organizationId,
  });
}

function createDesignerEvalHarnessInstructionBlock(input: {
  availableRepositoryHandles: readonly string[];
  seededState: DesignerEvalSeededState;
}): MistleManagedInstructionBlock {
  return {
    blockId: "mistle-designer-eval-harness",
    content: `
Designer eval harness context:

- This Designer session runs against an in-memory eval control plane, not the production control plane.
- Treat the seeded eval objects below as the available product state for this eval run only.
- Do not ask the user to paste or create a real GitHub connection when the seeded eval connection satisfies the workflow.
- Existing Connected app: GitHub, connection id \`${input.seededState.githubConnectionId}\`.
- Target sandbox profile draft: \`${input.seededState.targetDraft.profileId}\` version ${String(input.seededState.targetDraft.version)}.
- Available GitHub repositories for the seeded connection: ${input.availableRepositoryHandles
      .map((handle) => `\`${handle}\``)
      .join(", ")}.
- To select repositories, use \`dashboard_control.request_user_input\` with \`inputKind: "integrationConnectionResourceMultiSelect"\`, \`resourceSelection.connectionId: "${input.seededState.githubConnectionId}"\`, \`resourceSelection.resourceKind: "repository"\`, and \`submitAction.kind: "saveSelectedProviderResourcesToSandboxProfileDraft"\`.
- The eval control plane validates saved repository handles against the seeded list above.
`.trim(),
  };
}

function resolveEvalMistleMcpConfig(
  input: CompileEvalDesignerRuntimeInput,
): DesignerRuntimeMistleMcpConfig {
  if (input.config.mcp.mode === "disabled") {
    return {
      enabled: false,
    };
  }

  if (input.config.mcp.mode === "external") {
    return {
      enabled: true,
      url: input.config.mcp.url,
    };
  }

  if (input.evalControlPlaneBaseUrl === undefined) {
    throw new Error(
      "Designer eval config uses mcp.mode = 'eval-control-plane', but no eval control-plane base URL was provided.",
    );
  }

  return {
    enabled: true,
    url: new URL("/mcp", input.evalControlPlaneBaseUrl).toString(),
  };
}
