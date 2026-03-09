import type { AgentRuntimeRegistration } from "../../../agent-runtimes/conversation-provider-adapter.js";
import {
  OpenAiDefaultCodexAppServerRuntimeKey,
  OpenAiDefaultCodexConversationProviderFamily,
} from "./agent-runtime-constants.js";
import { createCodexConversationProviderAdapter } from "./codex-conversation-provider-adapter.js";

export const OpenAiDefaultAgentRuntimes: ReadonlyArray<AgentRuntimeRegistration> = [
  {
    familyId: "openai",
    variantId: "openai-default",
    runtimeKey: OpenAiDefaultCodexAppServerRuntimeKey,
    capabilities: {
      conversation: {
        providerFamily: OpenAiDefaultCodexConversationProviderFamily,
        createAdapter: createCodexConversationProviderAdapter,
      },
    },
  },
];

export { createCodexConversationProviderAdapter } from "./codex-conversation-provider-adapter.js";
