import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { z } from "zod";

export const AwsCredentialSecretTypes: {
  AWS_SECRET_ACCESS_KEY: "aws_secret_access_key";
} = {
  AWS_SECRET_ACCESS_KEY: "aws_secret_access_key",
};

const OptionalTrimmedStringSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length === 0 ? undefined : trimmedValue;
}, z.string().min(1).optional());

export const AwsAssumeRoleConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.AWS_ASSUME_ROLE),
    accessKeyId: z.string().trim().min(1),
    roleArn: z.string().trim().min(1),
    externalId: OptionalTrimmedStringSchema,
    durationSeconds: z.number().int().min(900).max(43_200).optional(),
  })
  .loose();

export type AwsAssumeRoleConnectionConfig = z.output<typeof AwsAssumeRoleConnectionConfigSchema>;
