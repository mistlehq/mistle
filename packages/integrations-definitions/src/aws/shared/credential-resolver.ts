import { AssumeRoleCommand, STSClient } from "@aws-sdk/client-sts";
import type {
  IntegrationCredentialResolver,
  IntegrationCredentialResolverInput,
} from "@mistle/integrations-core";

import { AwsAssumeRoleConnectionConfigSchema, AwsCredentialSecretTypes } from "./auth.js";
import { AwsBindingConfigSchema } from "./binding-config-schema.js";

export const AwsCredentialResolverKeys: {
  ASSUME_ROLE_SESSION: "assume_role_session";
} = {
  ASSUME_ROLE_SESSION: "assume_role_session",
};

type ResolvedAwsAssumeRoleCredentialContext = {
  accessKeyId: string;
  secretAccessKey: string;
  roleArn: string;
  defaultRegion: string;
  roleSessionName: string;
  externalId?: string;
  durationSeconds?: number;
};

function sanitizeRoleSessionNameSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9+=,.@_-]/gu, "-");
}

export function buildAwsAssumeRoleSessionName(input: {
  connectionId: string;
  bindingId?: string;
}): string {
  const segments = [
    "mistle",
    sanitizeRoleSessionNameSegment(input.connectionId),
    ...(input.bindingId === undefined ? [] : [sanitizeRoleSessionNameSegment(input.bindingId)]),
  ].filter((segment) => segment.length > 0);
  const sessionName = segments.join("-");

  if (sessionName.length === 0) {
    return "mistle-session";
  }

  if (sessionName.length <= 64) {
    return sessionName;
  }

  return sessionName.slice(0, 64);
}

export function resolveAwsAssumeRoleCredentialContext(
  input: IntegrationCredentialResolverInput,
): ResolvedAwsAssumeRoleCredentialContext {
  if (input.secretType !== AwsCredentialSecretTypes.AWS_SECRET_ACCESS_KEY) {
    throw new Error(
      `AWS assume-role resolver only supports '${AwsCredentialSecretTypes.AWS_SECRET_ACCESS_KEY}' secret type.`,
    );
  }

  if (
    input.purpose !== undefined &&
    input.purpose !== AwsCredentialSecretTypes.AWS_SECRET_ACCESS_KEY
  ) {
    throw new Error(
      `AWS assume-role resolver only supports purpose '${AwsCredentialSecretTypes.AWS_SECRET_ACCESS_KEY}'.`,
    );
  }

  if (input.binding === undefined) {
    throw new Error("AWS assume-role resolver requires binding config context.");
  }

  const parsedBindingConfig = AwsBindingConfigSchema.parse(input.binding.config);
  const parsedConnectionConfig = AwsAssumeRoleConnectionConfigSchema.parse(input.connection.config);
  const linkedCredential = input.linkedCredential;
  if (linkedCredential === undefined) {
    throw new Error("AWS assume-role resolver requires linked bootstrap credentials.");
  }

  if (linkedCredential.secretType !== AwsCredentialSecretTypes.AWS_SECRET_ACCESS_KEY) {
    throw new Error(
      `AWS assume-role resolver requires linked secret type '${AwsCredentialSecretTypes.AWS_SECRET_ACCESS_KEY}'.`,
    );
  }

  if (
    linkedCredential.purpose !== undefined &&
    linkedCredential.purpose !== AwsCredentialSecretTypes.AWS_SECRET_ACCESS_KEY
  ) {
    throw new Error(
      `AWS assume-role resolver requires linked credential purpose '${AwsCredentialSecretTypes.AWS_SECRET_ACCESS_KEY}'.`,
    );
  }

  return {
    accessKeyId: parsedConnectionConfig.accessKeyId,
    secretAccessKey: linkedCredential.value,
    roleArn: parsedConnectionConfig.roleArn,
    defaultRegion: parsedBindingConfig.defaultRegion,
    roleSessionName: buildAwsAssumeRoleSessionName({
      connectionId: input.connectionId,
      ...(input.binding === undefined ? {} : { bindingId: input.binding.id }),
    }),
    ...(parsedConnectionConfig.externalId === undefined
      ? {}
      : { externalId: parsedConnectionConfig.externalId }),
    ...(parsedConnectionConfig.durationSeconds === undefined
      ? {}
      : { durationSeconds: parsedConnectionConfig.durationSeconds }),
  };
}

async function assumeAwsRole(input: ResolvedAwsAssumeRoleCredentialContext): Promise<{
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiresAt: string;
}> {
  const client = new STSClient({
    region: input.defaultRegion,
    credentials: {
      accessKeyId: input.accessKeyId,
      secretAccessKey: input.secretAccessKey,
    },
  });

  try {
    const response = await client.send(
      new AssumeRoleCommand({
        RoleArn: input.roleArn,
        RoleSessionName: input.roleSessionName,
        ...(input.externalId === undefined ? {} : { ExternalId: input.externalId }),
        ...(input.durationSeconds === undefined ? {} : { DurationSeconds: input.durationSeconds }),
      }),
    );
    const credentials = response.Credentials;
    if (credentials === undefined) {
      throw new Error("AWS STS AssumeRole response did not include credentials.");
    }

    if (credentials.AccessKeyId === undefined || credentials.AccessKeyId.length === 0) {
      throw new Error("AWS STS AssumeRole response did not include an access key ID.");
    }

    if (credentials.SecretAccessKey === undefined || credentials.SecretAccessKey.length === 0) {
      throw new Error("AWS STS AssumeRole response did not include a secret access key.");
    }

    if (credentials.SessionToken === undefined || credentials.SessionToken.length === 0) {
      throw new Error("AWS STS AssumeRole response did not include a session token.");
    }

    if (credentials.Expiration === undefined) {
      throw new Error("AWS STS AssumeRole response did not include an expiration.");
    }

    return {
      accessKeyId: credentials.AccessKeyId,
      secretAccessKey: credentials.SecretAccessKey,
      sessionToken: credentials.SessionToken,
      expiresAt: credentials.Expiration.toISOString(),
    };
  } finally {
    client.destroy();
  }
}

export const AwsAssumeRoleCredentialResolver: IntegrationCredentialResolver = {
  async resolve(input) {
    const resolvedContext = resolveAwsAssumeRoleCredentialContext(input);
    const assumedRoleCredentials = await assumeAwsRole(resolvedContext);

    return {
      kind: "aws_session",
      accessKeyId: assumedRoleCredentials.accessKeyId,
      secretAccessKey: assumedRoleCredentials.secretAccessKey,
      sessionToken: assumedRoleCredentials.sessionToken,
      expiresAt: assumedRoleCredentials.expiresAt,
    };
  },
};
