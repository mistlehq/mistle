import type { AgentRuntimeMetadata } from "@mistle/integrations-core";

import { PiRuntimeConfigSchema } from "./runtime-config-schema.js";

export const PiRuntimeMetadata: AgentRuntimeMetadata<typeof PiRuntimeConfigSchema> = {
  runtimeId: "pi",
  displayName: "Pi",
  logoKey: "pi",
  configSchema: PiRuntimeConfigSchema,
  capabilities: {
    associatedResourceDelivery: {
      supported: true,
    },
    conversationDelivery: {
      idempotencyFingerprintRuntimeKey: "pi",
      createConversationRetryPolicy: "idempotent",
    },
  },
};
