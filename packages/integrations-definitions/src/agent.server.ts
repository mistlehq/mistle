import type { AgentConversationProvider } from "@mistle/integrations-core";

import { createOpenAiCodexConversationProvider } from "./openai/agent.server.js";
import { OpenAiApiKeyDefinition } from "./openai/index.js";

export function resolveAgentConversationProvider(
  integrationFamilyId: string,
): AgentConversationProvider {
  switch (integrationFamilyId) {
    case OpenAiApiKeyDefinition.familyId:
      return createOpenAiCodexConversationProvider();
  }

  throw new Error(`Unsupported conversation integration family '${integrationFamilyId}'.`);
}
