import { AssumeRoleCommand, type AssumeRoleCommandInput, STSClient } from "@aws-sdk/client-sts";
import {
  type IntegrationCredentialResolver,
  type IntegrationCredentialResolverInput,
} from "@mistle/integrations-core";
import { z } from "zod";

import {
  AwsAssumeRoleConnectionConfigSchema,
  AwsConnectionMethodIds,
  AwsCredentialResolverKeys,
  AwsCredentialSecretTypes,
} from "../variants/aws-cli-default/auth.js";
import { AwsBindingConfigSchema } from "../variants/aws-cli-default/binding-config-schema.js";

type ResolvedAwsAssumeRoleContext = {
  defaultRegion: string;
  accessKeyId: string;
  secretAccessKey: string;
  roleArn: string;
  roleSessionName: string;
  externalId?: string;
  durationSeconds?: number;
};

const RoleSessionNameLengthLimit = 64;
const AwsConnectionSecretSchema = z
  .object({
    secretAccessKey: z.string().min(1).optional(),
  })
  .loose();

function sanitizeRoleSessionNameSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9+=,.@-]/gu, "-");
}

export function createAwsAssumeRoleSessionName(input: {
  connectionId: string;
  bindingId: string;
}): string {
  const connectionSegment = sanitizeRoleSessionNameSegment(input.connectionId).slice(0, 24);
  const bindingSegment = sanitizeRoleSessionNameSegment(input.bindingId).slice(0, 24);
  const rawSessionName = `mistle-${connectionSegment}-${bindingSegment}`;

  return rawSessionName.slice(0, RoleSessionNameLengthLimit);
}

export function resolveAwsAssumeRoleContext(
  input: IntegrationCredentialResolverInput,
): ResolvedAwsAssumeRoleContext {
  if (input.secretType !== AwsCredentialSecretTypes.AWS_SECRET_ACCESS_KEY) {
    throw new Error(
      `AWS AssumeRole resolver only supports '${AwsCredentialSecretTypes.AWS_SECRET_ACCESS_KEY}' secret type.`,
    );
  }

  if (input.binding === undefined) {
    throw new Error("AWS AssumeRole resolver requires binding context.");
  }

  const parsedBindingConfig = AwsBindingConfigSchema.parse(input.binding.config);
  const parsedConnectionConfig = AwsAssumeRoleConnectionConfigSchema.parse(input.connection.config);
  if (parsedConnectionConfig.connection_method !== AwsConnectionMethodIds.AWS_ASSUME_ROLE) {
    throw new Error("AWS AssumeRole resolver requires an aws-assume-role connection config.");
  }

  const parsedConnectionSecrets = AwsConnectionSecretSchema.parse(input.connection.secrets ?? {});
  const secretAccessKey = parsedConnectionSecrets.secretAccessKey;
  if (secretAccessKey === undefined || secretAccessKey.length === 0) {
    throw new Error("AWS AssumeRole resolver requires connection secret `secretAccessKey`.");
  }

  return {
    defaultRegion: parsedBindingConfig.defaultRegion,
    accessKeyId: parsedConnectionConfig.accessKeyId,
    secretAccessKey,
    roleArn: parsedConnectionConfig.roleArn,
    roleSessionName: createAwsAssumeRoleSessionName({
      connectionId: input.connectionId,
      bindingId: input.binding.id,
    }),
    ...(parsedConnectionConfig.externalId === undefined
      ? {}
      : { externalId: parsedConnectionConfig.externalId }),
    ...(parsedConnectionConfig.durationSeconds === undefined
      ? {}
      : { durationSeconds: parsedConnectionConfig.durationSeconds }),
  };
}

export function createAssumeRoleCommandInput(
  context: ResolvedAwsAssumeRoleContext,
): AssumeRoleCommandInput {
  return {
    RoleArn: context.roleArn,
    RoleSessionName: context.roleSessionName,
    ...(context.externalId === undefined ? {} : { ExternalId: context.externalId }),
    ...(context.durationSeconds === undefined ? {} : { DurationSeconds: context.durationSeconds }),
  };
}

async function createAwsSessionCredential(input: {
  defaultRegion: string;
  accessKeyId: string;
  secretAccessKey: string;
  roleArn: string;
  roleSessionName: string;
  externalId?: string;
  durationSeconds?: number;
}) {
  const stsClient = new STSClient({
    region: input.defaultRegion,
    credentials: {
      accessKeyId: input.accessKeyId,
      secretAccessKey: input.secretAccessKey,
    },
  });
  const assumeRoleResponse = await stsClient.send(
    new AssumeRoleCommand(
      createAssumeRoleCommandInput({
        defaultRegion: input.defaultRegion,
        accessKeyId: input.accessKeyId,
        secretAccessKey: input.secretAccessKey,
        roleArn: input.roleArn,
        roleSessionName: input.roleSessionName,
        ...(input.externalId === undefined ? {} : { externalId: input.externalId }),
        ...(input.durationSeconds === undefined ? {} : { durationSeconds: input.durationSeconds }),
      }),
    ),
  );

  const accessKeyId = assumeRoleResponse.Credentials?.AccessKeyId;
  if (accessKeyId === undefined || accessKeyId.length === 0) {
    throw new Error("AWS AssumeRole response is missing `AccessKeyId`.");
  }

  const secretAccessKey = assumeRoleResponse.Credentials?.SecretAccessKey;
  if (secretAccessKey === undefined || secretAccessKey.length === 0) {
    throw new Error("AWS AssumeRole response is missing `SecretAccessKey`.");
  }

  const sessionToken = assumeRoleResponse.Credentials?.SessionToken;
  if (sessionToken === undefined || sessionToken.length === 0) {
    throw new Error("AWS AssumeRole response is missing `SessionToken`.");
  }

  const expiration = assumeRoleResponse.Credentials?.Expiration;
  if (expiration === undefined) {
    throw new Error("AWS AssumeRole response is missing `Expiration`.");
  }

  return {
    kind: "aws_session" as const,
    accessKeyId,
    secretAccessKey,
    sessionToken,
    expiresAt: expiration.toISOString(),
  };
}

export const AwsAssumeRoleSessionCredentialResolver: IntegrationCredentialResolver = {
  async resolve(input) {
    const context = resolveAwsAssumeRoleContext(input);

    return createAwsSessionCredential(context);
  },
};

export { AwsCredentialResolverKeys };
