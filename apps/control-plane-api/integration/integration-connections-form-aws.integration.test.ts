/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { IntegrationCredentialSecretKinds } from "@mistle/db/control-plane";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { CreateFormConnectionBodySchema } from "../src/integration-connections/create-form-connection/schema.js";
import {
  CreatedFormIntegrationConnectionSchema,
  IntegrationConnectionSchema,
} from "../src/integration-connections/schemas.js";
import { UpdateFormConnectionBodySchema } from "../src/integration-connections/update-form-connection/schema.js";
import {
  createFormConnection,
  expectCredentialSlots,
  readCredentialIds,
  seedIntegrationTarget,
  updateFormConnection,
} from "./helpers/integration-connections.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("AWS form integration connections", () => {
  it("creates an assume-role connection with an encrypted secret access key", async ({ env }) => {
    await seedAwsTarget(env);
    const session = await env.auth.createSession({
      email: "integration-new-connections-create-aws@example.com",
    });

    const response = await createFormConnection({
      env,
      targetKey: "aws-cli-default",
      cookie: session.cookie,
      body: CreateFormConnectionBodySchema.parse({
        displayName: "AWS assume role",
        methodId: IntegrationConnectionMethodIds.AWS_ASSUME_ROLE,
        config: {
          connection_method: IntegrationConnectionMethodIds.AWS_ASSUME_ROLE,
          accessKeyId: "AKIAEXAMPLE",
          roleArn: "arn:aws:iam::123456789012:role/mistle-dev",
          externalId: "mistle-external-id",
          durationSeconds: 3600,
        },
        secrets: {
          secretAccessKey: "aws-secret-access-key-value",
        },
      }),
    });

    expect(response.status).toBe(201);
    const connection = CreatedFormIntegrationConnectionSchema.parse(await response.json());
    expect(connection.targetKey).toBe("aws-cli-default");
    expect(connection.displayName).toBe("AWS assume role");
    expect(connection.status).toBe("active");
    expect(connection.config).toEqual({
      connection_method: IntegrationConnectionMethodIds.AWS_ASSUME_ROLE,
      accessKeyId: "AKIAEXAMPLE",
      roleArn: "arn:aws:iam::123456789012:role/mistle-dev",
      externalId: "mistle-external-id",
      durationSeconds: 3600,
    });
    expect(connection.targetSnapshotConfig).toEqual({});

    await expectCredentialSlots({
      env,
      connectionId: connection.id,
      organizationId: session.organizationId,
      expected: [
        {
          slotKey: "aws.aws-cli-default.aws-assume-role.secret-access-key",
          secretKind: IntegrationCredentialSecretKinds.AWS_SECRET_ACCESS_KEY,
          intendedFamilyId: "aws",
          plaintext: "aws-secret-access-key-value",
        },
      ],
    });
  });

  it("rotates the assume-role secret and updates role configuration", async ({ env }) => {
    await seedAwsTarget(env);
    const session = await env.auth.createSession({
      email: "integration-new-connections-update-aws@example.com",
    });
    const createResponse = await createFormConnection({
      env,
      targetKey: "aws-cli-default",
      cookie: session.cookie,
      body: CreateFormConnectionBodySchema.parse({
        displayName: "AWS assume role",
        methodId: IntegrationConnectionMethodIds.AWS_ASSUME_ROLE,
        config: {
          connection_method: IntegrationConnectionMethodIds.AWS_ASSUME_ROLE,
          accessKeyId: "AKIAEXAMPLE",
          roleArn: "arn:aws:iam::123456789012:role/mistle-dev",
          externalId: "mistle-external-id",
          durationSeconds: 3600,
        },
        secrets: {
          secretAccessKey: "aws-secret-access-key-original",
        },
      }),
    });
    expect(createResponse.status).toBe(201);
    const createdConnection = CreatedFormIntegrationConnectionSchema.parse(
      await createResponse.json(),
    );
    const previousCredentialIds = await readCredentialIds({
      env,
      connectionId: createdConnection.id,
    });

    const updateResponse = await updateFormConnection({
      env,
      connectionId: createdConnection.id,
      cookie: session.cookie,
      body: UpdateFormConnectionBodySchema.parse({
        displayName: "AWS assume role rotated",
        config: {
          connection_method: IntegrationConnectionMethodIds.AWS_ASSUME_ROLE,
          accessKeyId: "AKIAUPDATED",
          roleArn: "arn:aws:iam::123456789012:role/mistle-prod",
          externalId: "mistle-external-id-rotated",
          durationSeconds: 1800,
        },
        secrets: {
          secretAccessKey: "aws-secret-access-key-rotated",
        },
      }),
    });

    expect(updateResponse.status).toBe(200);
    const updatedConnection = IntegrationConnectionSchema.parse(await updateResponse.json());
    expect(updatedConnection.id).toBe(createdConnection.id);
    expect(updatedConnection.displayName).toBe("AWS assume role rotated");
    expect(updatedConnection.config).toEqual({
      connection_method: IntegrationConnectionMethodIds.AWS_ASSUME_ROLE,
      accessKeyId: "AKIAUPDATED",
      roleArn: "arn:aws:iam::123456789012:role/mistle-prod",
      externalId: "mistle-external-id-rotated",
      durationSeconds: 1800,
    });

    await expectCredentialSlots({
      env,
      connectionId: createdConnection.id,
      organizationId: session.organizationId,
      previousCredentialIds,
      expected: [
        {
          slotKey: "aws.aws-cli-default.aws-assume-role.secret-access-key",
          secretKind: IntegrationCredentialSecretKinds.AWS_SECRET_ACCESS_KEY,
          intendedFamilyId: "aws",
          plaintext: "aws-secret-access-key-rotated",
        },
      ],
    });
  });
});

async function seedAwsTarget(env: Parameters<typeof seedIntegrationTarget>[0]): Promise<void> {
  await seedIntegrationTarget(env, {
    targetKey: "aws-cli-default",
    familyId: "aws",
    variantId: "aws-cli-default",
    config: {},
  });
}
