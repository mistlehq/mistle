/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { IntegrationCredentialSecretKinds } from "@mistle/db/control-plane";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { DatadogCredentialSlotKeys } from "@mistle/integrations-definitions";
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

describe.concurrent("Datadog form integration connections", () => {
  it("creates an API-key connection with API and application credentials", async ({ env }) => {
    await seedDatadogTarget(env);
    const session = await env.auth.createSession({
      email: "integration-new-connections-create-datadog@example.com",
    });

    const response = await createFormConnection({
      env,
      targetKey: "datadog-default",
      cookie: session.cookie,
      body: CreateFormConnectionBodySchema.parse({
        displayName: "Datadog MCP",
        methodId: IntegrationConnectionMethodIds.API_KEY,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
        secrets: {
          apiKey: "datadog-api-key",
          applicationKey: "datadog-application-key",
        },
      }),
    });

    expect(response.status).toBe(201);
    const connection = CreatedFormIntegrationConnectionSchema.parse(await response.json());
    expect(connection.config).toEqual({
      connection_method: IntegrationConnectionMethodIds.API_KEY,
    });
    expect(connection.targetSnapshotConfig).toEqual({});

    await expectCredentialSlots({
      env,
      connectionId: connection.id,
      organizationId: session.organizationId,
      expected: [
        {
          slotKey: DatadogCredentialSlotKeys.API_KEY,
          secretKind: IntegrationCredentialSecretKinds.API_KEY,
          plaintext: "datadog-api-key",
        },
        {
          slotKey: DatadogCredentialSlotKeys.APPLICATION_KEY,
          secretKind: IntegrationCredentialSecretKinds.API_KEY,
          plaintext: "datadog-application-key",
        },
      ],
    });
  });

  it("rotates both Datadog credentials", async ({ env }) => {
    await seedDatadogTarget(env);
    const session = await env.auth.createSession({
      email: "integration-new-connections-update-datadog@example.com",
    });
    const createResponse = await createFormConnection({
      env,
      targetKey: "datadog-default",
      cookie: session.cookie,
      body: CreateFormConnectionBodySchema.parse({
        displayName: "Datadog MCP",
        methodId: IntegrationConnectionMethodIds.API_KEY,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
        secrets: {
          apiKey: "original-datadog-api-key",
          applicationKey: "original-datadog-application-key",
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
        displayName: "Datadog MCP rotated",
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
        secrets: {
          apiKey: "rotated-datadog-api-key",
          applicationKey: "rotated-datadog-application-key",
        },
      }),
    });

    expect(updateResponse.status).toBe(200);
    const updatedConnection = IntegrationConnectionSchema.parse(await updateResponse.json());
    expect(updatedConnection.displayName).toBe("Datadog MCP rotated");
    expect(updatedConnection.config).toEqual({
      connection_method: IntegrationConnectionMethodIds.API_KEY,
    });

    await expectCredentialSlots({
      env,
      connectionId: createdConnection.id,
      organizationId: session.organizationId,
      previousCredentialIds,
      expected: [
        {
          slotKey: DatadogCredentialSlotKeys.API_KEY,
          secretKind: IntegrationCredentialSecretKinds.API_KEY,
          plaintext: "rotated-datadog-api-key",
        },
        {
          slotKey: DatadogCredentialSlotKeys.APPLICATION_KEY,
          secretKind: IntegrationCredentialSecretKinds.API_KEY,
          plaintext: "rotated-datadog-application-key",
        },
      ],
    });
  });
});

async function seedDatadogTarget(env: Parameters<typeof seedIntegrationTarget>[0]): Promise<void> {
  await seedIntegrationTarget(env, {
    targetKey: "datadog-default",
    familyId: "datadog",
    variantId: "datadog-default",
    config: {},
  });
}
