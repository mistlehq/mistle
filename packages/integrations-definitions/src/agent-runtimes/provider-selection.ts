import type { AnyIntegrationDefinition } from "@mistle/integrations-core";

export function createAgentProviderKey(input: { familyId: string; variantId: string }): string {
  return `${input.familyId}:${input.variantId}`;
}

export function resolvePrimaryConversationIntegrationFamilyId(runtimeId: string): string | null {
  switch (runtimeId) {
    case "codex":
      return "openai";
    case "opencode":
      return "opencode";
    default:
      return null;
  }
}

export function agentDefinitionAllowsRuntime(input: {
  definition: AnyIntegrationDefinition | undefined;
  runtimeId: string;
}): boolean {
  return (
    input.definition?.kind === "agent" &&
    input.definition.allowedRuntimeIds?.includes(input.runtimeId) === true
  );
}
