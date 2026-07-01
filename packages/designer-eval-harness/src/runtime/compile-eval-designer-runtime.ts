import { createDesignerRuntimePlan } from "@mistle/control-plane-api/designer/runtime-plan";
import type { DesignerRuntimeMistleMcpConfig } from "@mistle/control-plane-api/designer/runtime-plan";
import type { MistleManagedInstructionBlock } from "@mistle/integrations-definitions/agent-runtimes/codex";

import type { DesignerEvalConfig } from "../config/designer-eval-config.ts";
import type { DesignerEvalSeedProviderResource, DesignerEvalSeededState } from "../types.ts";

export type CompileEvalDesignerRuntimeInput = {
  availableProviderResources: readonly DesignerEvalSeedProviderResource[];
  config: DesignerEvalConfig;
  designerSessionId: string;
  initialPrompt: string;
  openAiProviderMode?: "platform" | "local_subscription";
  seededState: DesignerEvalSeededState;
};

export function compileEvalDesignerRuntime(input: CompileEvalDesignerRuntimeInput) {
  return createDesignerRuntimePlan({
    additionalManagedInstructionBlocks: [
      createDesignerEvalHarnessInstructionBlock({
        availableProviderResources: input.availableProviderResources,
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
  });
}

function createDesignerEvalHarnessInstructionBlock(input: {
  availableProviderResources: readonly DesignerEvalSeedProviderResource[];
  seededState: DesignerEvalSeededState;
}): MistleManagedInstructionBlock {
  const githubConnection = input.seededState.providerConnections.find(
    (connection) => connection.providerFamilyId === "github",
  );
  const githubRepositoryHandles =
    githubConnection === undefined
      ? []
      : input.availableProviderResources
          .filter(
            (resource) =>
              resource.connectionId === githubConnection.id && resource.kind === "repository",
          )
          .map((resource) => resource.handle);

  return {
    blockId: "mistle-designer-eval-harness",
    content: `
Designer eval harness context:

- This Designer session runs against an in-memory eval control plane, not the production control plane.
- Treat the seeded eval objects below as the available product state for this eval run only.
- Do not ask the user to paste or create real provider connections when the seeded eval connections satisfy the workflow.
- Existing Connected apps:
${input.seededState.providerConnections
  .map(
    (connection) =>
      `  - ${connection.label}: connection id \`${connection.id}\`, target key \`${connection.targetKey}\`, provider family \`${connection.providerFamilyId}\``,
  )
  .join("\n")}
- Target sandbox profile draft: \`${input.seededState.targetDraft.profileId}\` version ${String(input.seededState.targetDraft.version)}.
- Available provider resources:
${input.availableProviderResources
  .map(
    (resource) =>
      `  - connection \`${resource.connectionId}\`, kind \`${resource.kind}\`, handle \`${resource.handle}\``,
  )
  .join("\n")}
${
  githubConnection === undefined
    ? ""
    : `- To select GitHub repositories, use \`dashboard_control.request_user_input\` with \`inputKind: "integrationConnectionResourceMultiSelect"\`, \`resourceSelection.connectionId: "${githubConnection.id}"\`, \`resourceSelection.resourceKind: "repository"\`, and \`submitAction.kind: "saveSelectedProviderResourcesToSandboxProfileDraft"\`.
- Available GitHub repositories for that connection: ${githubRepositoryHandles
        .map((handle) => `\`${handle}\``)
        .join(", ")}.`
}
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

  const unsupportedConfig: never = input.config.mcp;
  throw new Error(`Unsupported Designer eval MCP config ${JSON.stringify(unsupportedConfig)}.`);
}
