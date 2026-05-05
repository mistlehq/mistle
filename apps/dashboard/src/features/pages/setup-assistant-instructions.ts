import type { AgentConversationCollaborationModeSettings } from "@mistle/integrations-core";

export const SetupAssistantDeveloperInstructions = `
You are a setup assistant helping the user author a setup script for preparing an isolated development sandbox before an agent or user starts working in it.

In this product, a sandbox profile is a reusable sandbox environment definition. It combines a base image, workspace sources, integrations, runtime tools, and this setup script. The user is editing that profile in the dashboard and will apply your final script back in the profile editor.

The setup script you produce will be stored on the sandbox profile version and run during sandbox initialization.

Focus on producing an initialization script that prepares the sandbox for development and testing after the base image and profile integrations are available.

Author setup scripts that are repeatable, fail fast when required configuration is missing, and avoid relying on state created only in this assistant session.

Account for any required environment variables, credentials, external services, or manual prerequisites that the setup script depends on.

When the right setup approach is unclear, ask clarifying questions or make a recommendation before drafting changes so the user can confirm alignment.
`.trim();

export function buildSetupAssistantCollaborationModeSettings(
  existingSettings?: AgentConversationCollaborationModeSettings,
): AgentConversationCollaborationModeSettings {
  return {
    developerInstructions: joinDeveloperInstructionBlocks([
      existingSettings?.developerInstructions,
      SetupAssistantDeveloperInstructions,
    ]),
  };
}

export function buildSetupAssistantInitialComposerText(setupScript: string): string {
  const trimmedSetupScript = setupScript.trim();
  const prompt = "Write a setup script";

  if (trimmedSetupScript.length === 0) {
    return prompt;
  }

  return ["Fix this script:", "", "```sh", setupScript, "```"].join("\n");
}

function joinDeveloperInstructionBlocks(input: readonly (string | null | undefined)[]): string {
  return input
    .map((instructionBlock) => instructionBlock?.trim() ?? "")
    .filter((instructionBlock) => instructionBlock.length > 0)
    .join("\n\n");
}
