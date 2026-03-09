import {
  ConversationProviderFamilies,
  type ConversationProviderFamily,
} from "@mistle/db/control-plane";
import {
  createCodexConversationProviderAdapter,
  type ConversationProviderAdapter,
} from "@mistle/integrations-definitions/agent-runtimes";

export type {
  ConversationProviderAdapter,
  ProviderConnection,
  ProviderConnectInput,
  ProviderCreateConversationInput,
  ProviderCreateConversationOutput,
  ProviderInspectConversationInput,
  ProviderInspectConversationOutput,
  ProviderInterruptExecutionInput,
  ProviderResumeConversationInput,
  ProviderStartExecutionInput,
  ProviderStartExecutionOutput,
  ProviderSteerExecutionInput,
  ProviderSteerExecutionOutput,
} from "@mistle/integrations-definitions/agent-runtimes";

export function getConversationProviderAdapter(
  providerFamily: ConversationProviderFamily,
): ConversationProviderAdapter {
  switch (providerFamily) {
    case ConversationProviderFamilies.CODEX:
      return createCodexConversationProviderAdapter();
  }
}
