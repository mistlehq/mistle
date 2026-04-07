import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";

function normalizeTitleCandidate(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const normalizedValue = value.trim();
  return normalizedValue.length > 0 ? normalizedValue : null;
}

export function resolveSandboxInstanceTitleCandidate(input: {
  conversationName: string | null;
  conversationPreview: string | null;
}): string | null {
  const name = normalizeTitleCandidate(input.conversationName);
  if (name !== null) {
    return name;
  }

  return normalizeTitleCandidate(input.conversationPreview);
}

export async function seedSandboxInstanceTitle(
  deps: {
    dataPlaneClient: Pick<
      DataPlaneSandboxInstancesClient,
      "getSandboxInstance" | "patchSandboxInstanceTitle"
    >;
  },
  input: {
    organizationId: string;
    sandboxInstanceId: string;
    conversationName: string | null;
    conversationPreview: string | null;
  },
): Promise<void> {
  const title = resolveSandboxInstanceTitleCandidate({
    conversationName: input.conversationName,
    conversationPreview: input.conversationPreview,
  });
  if (title === null) {
    return;
  }

  const sandboxInstance = await deps.dataPlaneClient.getSandboxInstance({
    organizationId: input.organizationId,
    instanceId: input.sandboxInstanceId,
  });
  if (sandboxInstance === null) {
    throw new Error(`Sandbox instance '${input.sandboxInstanceId}' was not found.`);
  }
  if (sandboxInstance.title !== null) {
    return;
  }

  await deps.dataPlaneClient.patchSandboxInstanceTitle({
    organizationId: input.organizationId,
    instanceId: input.sandboxInstanceId,
    title,
  });
}
