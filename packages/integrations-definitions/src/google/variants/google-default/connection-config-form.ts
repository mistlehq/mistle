import type { IntegrationFormDefinition } from "@mistle/integrations-core";

import type { GoogleConnectionConfig } from "./auth.js";
import type { GoogleBindingConfig } from "./binding-config-schema.js";
import type { GoogleTargetConfig } from "./target-config-schema.js";
import type { GoogleTargetSecrets } from "./target-secret-schema.js";

export const GoogleServiceAccountConnectionConfigForm: IntegrationFormDefinition<
  GoogleTargetConfig,
  GoogleTargetSecrets,
  GoogleBindingConfig,
  GoogleConnectionConfig
> = () => ({
  schema: {
    type: "object",
    properties: {},
  },
  uiSchema: {},
});

export const GoogleServiceAccountDomainWideDelegationConnectionConfigForm: IntegrationFormDefinition<
  GoogleTargetConfig,
  GoogleTargetSecrets,
  GoogleBindingConfig,
  GoogleConnectionConfig
> = () => ({
  schema: {
    type: "object",
    properties: {},
  },
  uiSchema: {},
});
