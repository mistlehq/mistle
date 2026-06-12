import type { IntegrationCredentialResolverInput } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import {
  AwsConnectionMethodIds,
  AwsCredentialSecretTypes,
} from "../variants/aws-cli-default/auth.js";
import {
  createAssumeRoleCommandInput,
  createAwsAssumeRolePublicErrorMessage,
  createAwsAssumeRoleSessionName,
  createAwsAssumeRoleTelemetryAttributes,
  resolveAwsAssumeRoleContext,
} from "./credential-resolver.server.js";

function createResolverInput(
  overrides?: Omit<Partial<IntegrationCredentialResolverInput>, "binding"> & {
    binding?: IntegrationCredentialResolverInput["binding"];
  },
): IntegrationCredentialResolverInput {
  const input: IntegrationCredentialResolverInput = {
    organizationId: "org_test",
    targetKey: "aws-cli-default",
    connectionId: "icn_aws_test",
    target: {
      familyId: "aws",
      variantId: "aws-cli-default",
      enabled: true,
      config: {},
      secrets: {},
    },
    connection: {
      id: "icn_aws_test",
      status: "active",
      config: {
        connection_method: AwsConnectionMethodIds.AWS_ASSUME_ROLE,
        accessKeyId: "AKIAEXAMPLE",
        roleArn: "arn:aws:iam::123456789012:role/mistle-dev",
        externalId: "mistle-external-id",
        durationSeconds: 3600,
      },
      secrets: {
        secretAccessKey: "aws-secret-access-key-value",
      },
    },
    binding: {
      id: "ibd_aws_test",
      kind: "connector",
      config: {
        services: ["secretsmanager", "sts"],
        regions: ["us-east-1", "us-west-2"],
        defaultRegion: "us-east-1",
        tools: ["aws-cli"],
      },
    },
    secretType: AwsCredentialSecretTypes.AWS_SECRET_ACCESS_KEY,
  };

  return {
    organizationId: overrides?.organizationId ?? input.organizationId,
    targetKey: overrides?.targetKey ?? input.targetKey,
    connectionId: overrides?.connectionId ?? input.connectionId,
    target: overrides?.target ?? input.target,
    connection: overrides?.connection ?? input.connection,
    secretType: overrides?.secretType ?? input.secretType,
    ...((overrides?.binding ?? input.binding) === undefined
      ? {}
      : { binding: overrides?.binding ?? input.binding }),
    ...(overrides?.slotKey === undefined ? {} : { slotKey: overrides.slotKey }),
  };
}

describe("aws credential resolver helpers", () => {
  it("resolves assume-role context from binding config, connection config, and hydrated form secret", () => {
    expect(resolveAwsAssumeRoleContext(createResolverInput())).toEqual({
      defaultRegion: "us-east-1",
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "aws-secret-access-key-value",
      roleArn: "arn:aws:iam::123456789012:role/mistle-dev",
      roleSessionName: "mistle-icn-aws-test-ibd-aws-test",
      externalId: "mistle-external-id",
      durationSeconds: 3600,
    });
  });

  it("resolves a custom STS endpoint from target config", () => {
    expect(
      resolveAwsAssumeRoleContext(
        createResolverInput({
          target: {
            familyId: "aws",
            variantId: "aws-cli-default",
            enabled: true,
            config: {
              stsEndpointUrl: "http://127.0.0.1:4566",
            },
            secrets: {},
          },
        }),
      ),
    ).toMatchObject({
      stsEndpointUrl: "http://127.0.0.1:4566",
    });
  });

  it("builds AssumeRole input with optional external id and duration", () => {
    expect(
      createAssumeRoleCommandInput({
        defaultRegion: "us-east-1",
        accessKeyId: "AKIAEXAMPLE",
        secretAccessKey: "aws-secret-access-key-value",
        roleArn: "arn:aws:iam::123456789012:role/mistle-dev",
        roleSessionName: "mistle-session",
        externalId: "mistle-external-id",
        durationSeconds: 3600,
      }),
    ).toEqual({
      RoleArn: "arn:aws:iam::123456789012:role/mistle-dev",
      RoleSessionName: "mistle-session",
      ExternalId: "mistle-external-id",
      DurationSeconds: 3600,
    });
  });

  it("builds non-sensitive telemetry attributes for AssumeRole resolution", () => {
    expect(
      createAwsAssumeRoleTelemetryAttributes({
        roleArn: "arn:aws:iam::123456789012:role/mistle-dev",
        defaultRegion: "us-east-1",
        roleSessionName: "mistle-session",
        externalIdPresent: true,
        durationSeconds: 3600,
      }),
    ).toEqual({
      "mistle.aws.role_arn": "arn:aws:iam::123456789012:role/mistle-dev",
      "mistle.aws.region": "us-east-1",
      "mistle.aws.role_session_name": "mistle-session",
      "mistle.aws.external_id_present": true,
      "mistle.aws.duration_seconds": 3600,
    });
  });

  it("builds public AssumeRole error messages without exposing provider identifiers", () => {
    const error = new Error(
      "User arn:aws:iam::123456789012:user/mistle-test is not authorized to perform: sts:AssumeRole on resource: arn:aws:iam::123456789012:role/mistle-dev",
    );
    error.name = "AccessDenied";

    const message = createAwsAssumeRolePublicErrorMessage(error);

    expect(message).toBe(
      "AWS AssumeRole credential resolution failed: AWS STS denied the AssumeRole request. Check that the configured access key principal can assume the configured IAM role, the role trust policy allows it, and the external ID matches if one is configured.",
    );
    expect(message).not.toContain("123456789012");
    expect(message).not.toContain("mistle-test");
    expect(message).not.toContain("mistle-dev");
  });

  it("builds a public AssumeRole error message for rejected access key credentials", () => {
    const error = new Error("The security token included in the request is invalid.");
    error.name = "UnrecognizedClientException";

    expect(createAwsAssumeRolePublicErrorMessage(error)).toBe(
      "AWS AssumeRole credential resolution failed: AWS STS rejected the configured access key credentials. Check that the access key ID and secret access key are active and belong together.",
    );
  });

  it("fails fast when binding context is missing", () => {
    const resolverInput = createResolverInput();
    delete resolverInput.binding;

    expect(() => resolveAwsAssumeRoleContext(resolverInput)).toThrow(
      "AWS AssumeRole resolver requires binding context.",
    );
  });

  it("fails fast when the bootstrap secret access key is missing", () => {
    expect(() =>
      resolveAwsAssumeRoleContext(
        createResolverInput({
          connection: {
            id: "icn_aws_test",
            status: "active",
            config: {
              connection_method: AwsConnectionMethodIds.AWS_ASSUME_ROLE,
              accessKeyId: "AKIAEXAMPLE",
              roleArn: "arn:aws:iam::123456789012:role/mistle-dev",
            },
            secrets: {},
          },
        }),
      ),
    ).toThrow("AWS AssumeRole resolver requires connection secret `secretAccessKey`.");
  });

  it("creates deterministic session names within the AWS length limit", () => {
    const sessionName = createAwsAssumeRoleSessionName({
      connectionId: "icn_aws_test_with/really.long-id.segment",
      bindingId: "ibd_aws_test_with.another:segment_and_more_characters",
    });
    const truncatedAnother = "another".slice(0, 6);

    expect(sessionName).toBe(
      `mistle-icn-aws-test-with-really-ibd-aws-test-with.${truncatedAnother}`,
    );
    expect(sessionName.length).toBeLessThanOrEqual(64);
  });
});
