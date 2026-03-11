import { resolveIntegrationTargetSecrets } from "../../integration-targets/services/resolve-target-secrets.js";
import type { AppContext } from "../../types.js";
import {
  InternalIntegrationCredentialsError,
  InternalIntegrationCredentialsErrorCodes,
} from "./errors.js";

type IntegrationTargetEncryptedSecretsInput = {
  ciphertext: string;
  nonce: string;
  masterKeyVersion: number;
};

export type ResolveIntegrationTargetSecretsInput = {
  targets: ReadonlyArray<{
    targetKey: string;
    encryptedSecrets: IntegrationTargetEncryptedSecretsInput | null;
  }>;
};

export type ResolveIntegrationTargetSecretsOutput = {
  targets: Array<{
    targetKey: string;
    secrets: Record<string, string>;
  }>;
};

export function resolveInternalIntegrationTargetSecrets(
  integrationsConfig: AppContext["var"]["config"]["integrations"],
  input: ResolveIntegrationTargetSecretsInput,
): ResolveIntegrationTargetSecretsOutput {
  const targets = input.targets.map((target) => {
    try {
      return {
        targetKey: target.targetKey,
        secrets: resolveIntegrationTargetSecrets({
          integrationsConfig,
          target: {
            targetKey: target.targetKey,
            secrets: target.encryptedSecrets,
          },
        }),
      };
    } catch {
      throw new InternalIntegrationCredentialsError(
        InternalIntegrationCredentialsErrorCodes.INVALID_TARGET_SECRETS,
        400,
        `Target '${target.targetKey}' has invalid encrypted target secrets.`,
      );
    }
  });

  return {
    targets,
  };
}
