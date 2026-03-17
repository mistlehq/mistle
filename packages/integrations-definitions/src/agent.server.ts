import type { AgentConversationProvider, AgentExecutionObserver } from "@mistle/integrations-core";

import {
  createOpenAiCodexConversationProvider,
  createOpenAiCodexExecutionObserver,
} from "./openai/agent.server.js";
import { OpenAiApiKeyDefinition } from "./openai/index.js";
import { OpenAiAgentAdapterKeys } from "./openai/variants/openai-default/adapter-keys.js";

export function resolveAgentConversationProvider(
  integrationFamilyId: string,
): AgentConversationProvider {
  switch (integrationFamilyId) {
    case OpenAiApiKeyDefinition.familyId:
      return createOpenAiCodexConversationProvider();
  }

  throw new Error(`Unsupported conversation integration family '${integrationFamilyId}'.`);
}

export function resolveAgentExecutionObserver(adapterKey: string): AgentExecutionObserver {
  switch (adapterKey) {
    case OpenAiAgentAdapterKeys.OPENAI_CODEX:
      return createOpenAiCodexExecutionObserver();
  }

  throw new Error(`Unsupported agent execution observer adapter '${adapterKey}'.`);
}
