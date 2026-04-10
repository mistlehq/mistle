import { IntegrationKinds, type IntegrationDefinition } from "@mistle/integrations-core";

import {
  AwsAssumeRoleConnectionConfigSchema,
  type AwsConnectionConfig,
  AwsConnectionMethodIds,
  AwsCredentialSecretTypes,
  AwsCredentialSlotKeys,
} from "./auth.js";
import { resolveAwsBindingConfigForm } from "./binding-config-form.js";
import { AwsBindingConfigSchema } from "./binding-config-schema.js";
import { compileAwsBinding } from "./compile-binding.js";
import { AwsAssumeRoleConnectionConfigForm } from "./connection-config-form.js";
import { AwsTargetConfigSchema } from "./target-config-schema.js";
import { AwsTargetSecretSchema } from "./target-secret-schema.js";

export type AwsBaseIntegrationDefinition = IntegrationDefinition<
  typeof AwsTargetConfigSchema,
  typeof AwsTargetSecretSchema,
  typeof AwsBindingConfigSchema,
  AwsConnectionConfig
>;

export const AwsBaseDefinition: AwsBaseIntegrationDefinition = {
  familyId: "aws",
  variantId: "aws-cli-default",
  kind: IntegrationKinds.CONNECTOR,
  displayName: "AWS",
  description: "Enable scoped AWS access and optional AWS CLI support in sandbox.",
  logoKey: "aws",
  targetConfigSchema: AwsTargetConfigSchema,
  targetSecretSchema: AwsTargetSecretSchema,
  bindingConfigSchema: AwsBindingConfigSchema,
  bindingConfigForm: resolveAwsBindingConfigForm,
  connectionMethods: [
    {
      id: AwsConnectionMethodIds.AWS_ASSUME_ROLE,
      label: "Access key + AssumeRole",
      kind: "form",
      secretFields: [
        {
          name: "secretAccessKey",
          label: "Secret access key",
          inputType: "password",
          secretType: AwsCredentialSecretTypes.AWS_SECRET_ACCESS_KEY,
          slotKey: AwsCredentialSlotKeys.SECRET_ACCESS_KEY,
        },
      ],
      configSchema: AwsAssumeRoleConnectionConfigSchema,
      configForm: AwsAssumeRoleConnectionConfigForm,
    },
  ],
  compileBinding: compileAwsBinding,
};
