import {
  IntegrationKinds,
  IntegrationMcpTransports,
  type IntegrationDefinition,
} from "@mistle/integrations-core";

import {
  AwsAssumeRoleConnectionConfigSchema,
  type AwsConnectionConfig,
  AwsConnectionMethodIds,
  AwsCredentialSecretTypes,
  AwsCredentialSlotKeys,
} from "./auth.js";
import { resolveAwsBindingConfigForm } from "./binding-config-form.js";
import { AwsBindingConfigSchema } from "./binding-config-schema.js";
import { AwsCloudWatchMcpWrapperPath, compileAwsBinding } from "./compile-binding.js";
import { AwsAssumeRoleConnectionConfigForm } from "./connection-config-form.js";
import { AwsTargetConfigSchema } from "./target-config-schema.js";
import { AwsTargetSecretSchema } from "./target-secret-schema.js";
import { AwsToolIds } from "./tool-ids.js";

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
  description: "Enable scoped AWS access for selected sandbox tools and MCP servers.",
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
          description:
            "Secret for the source access key. Mistle stores it encrypted and uses it only to request temporary role credentials.",
          inputType: "password",
          secretType: AwsCredentialSecretTypes.AWS_SECRET_ACCESS_KEY,
          slotKey: AwsCredentialSlotKeys.SECRET_ACCESS_KEY,
        },
      ],
      configSchema: AwsAssumeRoleConnectionConfigSchema,
      configForm: AwsAssumeRoleConnectionConfigForm,
    },
  ],
  mcp: (input) =>
    input.binding.config.tools.includes(AwsToolIds.AWS_CLOUDWATCH_MCP)
      ? [
          {
            serverId: AwsToolIds.AWS_CLOUDWATCH_MCP,
            serverName: "aws_cloudwatch",
            transport: IntegrationMcpTransports.STDIO,
            command: AwsCloudWatchMcpWrapperPath,
            description: "CloudWatch and CloudWatch Logs MCP tools backed by the AWS connection.",
          },
        ]
      : [],
  compileBinding: compileAwsBinding,
};
