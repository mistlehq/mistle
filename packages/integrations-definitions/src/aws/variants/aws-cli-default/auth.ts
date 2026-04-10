import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { z } from "zod";

export const AwsConnectionMethodIds = {
  AWS_ASSUME_ROLE: IntegrationConnectionMethodIds.AWS_ASSUME_ROLE,
} as const;

export const AwsCredentialSecretTypes = {
  AWS_SECRET_ACCESS_KEY: "aws_secret_access_key",
} as const;

export const AwsCredentialSlotKeys = {
  SECRET_ACCESS_KEY: "aws.aws-cli-default.aws-assume-role.secret-access-key",
} as const;

export const AwsCredentialResolverKeys = {
  ASSUME_ROLE_SESSION: "assume-role-session",
} as const;

export const AwsAssumeRoleConnectionConfigSchema = z
  .object({
    connection_method: z.literal(AwsConnectionMethodIds.AWS_ASSUME_ROLE),
    accessKeyId: z.string().trim().min(1),
    roleArn: z.string().trim().min(1),
    externalId: z.string().trim().min(1).optional(),
    durationSeconds: z.number().int().min(900).max(43_200).optional(),
  })
  .strict();

export type AwsConnectionConfig = z.output<typeof AwsAssumeRoleConnectionConfigSchema>;
