import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";

import { getConversationProviderAdapter } from "./provider-adapter.js";

type SandboxInstanceTitleSeedResult = "completed" | "unsupported";

async function generateTriggerConversationTitle(input: {
  runtimeId: string;
  getConnectionUrl: () => Promise<string>;
  providerConversationId: string;
  providerState?: unknown;
  inputText: string;
}): Promise<string | null> {
  const adapter = getConversationProviderAdapter(input.runtimeId);
  if (adapter.generateConversationTitle === undefined) {
    return null;
  }

  const result = await adapter.generateConversationTitle({
    connectionUrl: await input.getConnectionUrl(),
    providerConversationId: input.providerConversationId,
    providerState: input.providerState,
    inputText: input.inputText,
  });

  return result.title;
}

export async function seedSandboxInstanceTitle(
  deps: {
    dataPlaneClient: Pick<
      DataPlaneSandboxInstancesClient,
      "getSandboxInstance" | "patchSandboxInstanceTitle"
    >;
  },
  input: {
    getConnectionUrl: () => Promise<string>;
    inputText: string;
    organizationId: string;
    providerConversationId: string;
    providerState?: unknown;
    runtimeId: string;
    sandboxInstanceId: string;
  },
): Promise<SandboxInstanceTitleSeedResult> {
  const sandboxInstance = await deps.dataPlaneClient.getSandboxInstance({
    organizationId: input.organizationId,
    instanceId: input.sandboxInstanceId,
  });
  if (sandboxInstance === null) {
    throw new Error(`Sandbox instance '${input.sandboxInstanceId}' was not found.`);
  }
  if (sandboxInstance.title !== null) {
    return "completed";
  }

  const title = await generateTriggerConversationTitle({
    runtimeId: input.runtimeId,
    getConnectionUrl: input.getConnectionUrl,
    providerConversationId: input.providerConversationId,
    providerState: input.providerState,
    inputText: input.inputText,
  });
  if (title === null) {
    return "unsupported";
  }

  await deps.dataPlaneClient.patchSandboxInstanceTitle({
    organizationId: input.organizationId,
    instanceId: input.sandboxInstanceId,
    onlyIfUnset: true,
    title,
  });
  return "completed";
}
