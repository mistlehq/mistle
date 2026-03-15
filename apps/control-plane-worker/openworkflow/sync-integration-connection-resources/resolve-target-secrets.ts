import type { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";

export async function resolveTargetSecrets(input: {
  targetKey: string;
  encryptedSecrets: {
    ciphertext: string;
    nonce: string;
    masterKeyVersion: number;
  } | null;
  controlPlaneInternalClient: ControlPlaneInternalClient | undefined;
}): Promise<{ secrets: Record<string, string> }> {
  if (input.encryptedSecrets === null) {
    return {
      secrets: {},
    };
  }

  if (input.controlPlaneInternalClient === undefined) {
    throw new Error("Resource sync target secret resolution is not configured.");
  }

  const resolvedSecrets = await input.controlPlaneInternalClient.resolveIntegrationTargetSecrets({
    targets: [
      {
        targetKey: input.targetKey,
        encryptedSecrets: input.encryptedSecrets,
      },
    ],
  });
  const resolvedTarget = resolvedSecrets.targets[0];
  if (resolvedTarget === undefined) {
    throw new Error(`Resolved target secrets for '${input.targetKey}' were not returned.`);
  }

  return {
    secrets: resolvedTarget.secrets,
  };
}
