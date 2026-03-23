import type { IntegrationTarget } from "@mistle/db/control-plane";

import type { AppContext } from "../types.js";
import {
  decryptIntegrationTargetSecrets,
  resolveMasterEncryptionKeyMaterial,
  type IntegrationTargetSecrets,
} from "./crypto.js";

type IntegrationsConfig = AppContext["var"]["config"]["integrations"];

export function resolveIntegrationTargetSecrets(input: {
  integrationsConfig: IntegrationsConfig;
  target: Pick<IntegrationTarget, "targetKey" | "secrets">;
}): IntegrationTargetSecrets {
  if (input.target.secrets === null) {
    return {};
  }

  const masterEncryptionKeyMaterial = resolveMasterEncryptionKeyMaterial({
    masterKeyVersion: input.target.secrets.masterKeyVersion,
    masterEncryptionKeys: input.integrationsConfig.masterEncryptionKeys,
  });

  return decryptIntegrationTargetSecrets({
    nonce: input.target.secrets.nonce,
    ciphertext: input.target.secrets.ciphertext,
    masterEncryptionKeyMaterial,
  });
}
