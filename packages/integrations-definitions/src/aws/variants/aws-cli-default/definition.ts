import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  type IntegrationDefinition,
} from "@mistle/integrations-core";
import { z } from "zod";

import {
  type AwsAssumeRoleConnectionConfig,
  AwsAssumeRoleConnectionConfigSchema,
  AwsCredentialSecretTypes,
} from "../../shared/auth.js";
import { AwsBindingConfigForm } from "../../shared/binding-config-form.js";
import { AwsBindingConfigSchema } from "../../shared/binding-config-schema.js";
import { AwsAssumeRoleConnectionConfigForm } from "../../shared/connection-config-form.js";
import { AwsDefaultVariantId, AwsFamilyId } from "../../shared/constants.js";
import { AwsTargetConfigSchema } from "../../shared/target-config-schema.js";
import { compileAwsCliDefaultBinding } from "./compile-binding.js";

type AwsCliDefaultIntegrationDefinition = IntegrationDefinition<
  typeof AwsTargetConfigSchema,
  typeof AwsTargetSecretSchema,
  typeof AwsBindingConfigSchema,
  AwsAssumeRoleConnectionConfig
>;

const AwsTargetSecretSchema = z.object({}).strict();

export const AwsCliDefaultDefinition: AwsCliDefaultIntegrationDefinition = {
  familyId: AwsFamilyId,
  variantId: AwsDefaultVariantId,
  kind: IntegrationKinds.AGENT,
  displayName: "AWS",
  description: "Enable AWS CLI access with assume-role and proxy-side SigV4 signing.",
  logoKey: "aws",
  targetConfigSchema: AwsTargetConfigSchema,
  targetSecretSchema: AwsTargetSecretSchema,
  bindingConfigSchema: AwsBindingConfigSchema,
  bindingConfigForm: AwsBindingConfigForm,
  connectionMethods: [
    {
      id: IntegrationConnectionMethodIds.AWS_ASSUME_ROLE,
      label: "Access key + AssumeRole",
      kind: "form",
      secretFields: [
        {
          name: "secretAccessKey",
          label: "Secret access key",
          placeholder: "Enter secret access key",
          inputType: "password",
          secretType: AwsCredentialSecretTypes.AWS_SECRET_ACCESS_KEY,
        },
      ],
      configSchema: AwsAssumeRoleConnectionConfigSchema,
      configForm: AwsAssumeRoleConnectionConfigForm,
    },
  ],
  compileBinding: compileAwsCliDefaultBinding,
};
