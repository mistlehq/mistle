import type { IntegrationIdentityLinkingCapability } from "@mistle/integrations-core";

import {
  type LinearConnectionConfig,
  LinearConnectionMethodIds,
  LinearCredentialSlotKeys,
  LinearOAuthAppConnectionConfigSchema,
} from "./auth.js";
import type { LinearTargetConfig } from "./target-config-schema.js";

export const LinearIdentityLinkingCapability: IntegrationIdentityLinkingCapability<
  LinearTargetConfig,
  Record<string, string>,
  LinearConnectionConfig
> = {
  eligibleConnectionMethodIds: [LinearConnectionMethodIds.OAUTH_APP],
  supportsConnection(input) {
    const parsedConnectionConfig = LinearOAuthAppConnectionConfigSchema.safeParse(
      input.connection.config,
    );
    if (!parsedConnectionConfig.success) {
      return false;
    }

    return input.availableConnectionSecretSlotKeys.has(
      LinearCredentialSlotKeys.OAUTH_APP_CLIENT_SECRET,
    );
  },
};
