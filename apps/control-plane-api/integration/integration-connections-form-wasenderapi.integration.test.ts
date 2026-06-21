/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  IntegrationConnectionMethodIds,
  ProviderConfigurationSetupCompletedConfigKey,
} from "@mistle/integrations-core";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { CreateDraftFormConnectionBodySchema } from "../src/integration-connections/create-draft-form-connection/schema.js";
import { IntegrationConnectionSchema } from "../src/integration-connections/schemas.js";
import { UpdateFormConnectionBodySchema } from "../src/integration-connections/update-form-connection/schema.js";
import {
  createDraftFormConnection,
  seedIntegrationTarget,
  updateFormConnection,
} from "./helpers/integration-connections.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("WasenderAPI form integration connections", () => {
  it("ignores client-submitted provider setup completion markers on ordinary updates", async ({
    env,
  }) => {
    const targetKey = "wasenderapi-marker-spoofing";
    await seedWasenderApiTarget(env, targetKey);
    const session = await env.auth.createSession({
      email: "integration-new-connections-update-wasenderapi-marker@example.com",
    });

    const createResponse = await createDraftFormConnection({
      env,
      targetKey,
      methodId: IntegrationConnectionMethodIds.API_KEY,
      cookie: session.cookie,
      body: CreateDraftFormConnectionBodySchema.parse({
        displayName: "WasenderAPI draft",
      }),
    });
    expect(createResponse.status).toBe(201);
    const createdConnection = IntegrationConnectionSchema.parse(await createResponse.json());

    const updateResponse = await updateFormConnection({
      env,
      connectionId: createdConnection.id,
      cookie: session.cookie,
      body: UpdateFormConnectionBodySchema.parse({
        displayName: "WasenderAPI renamed",
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
          [ProviderConfigurationSetupCompletedConfigKey]: "provider-configuration",
        },
      }),
    });

    expect(updateResponse.status).toBe(200);
    const updatedConnection = IntegrationConnectionSchema.parse(await updateResponse.json());
    expect(updatedConnection.config).toEqual({
      connection_method: IntegrationConnectionMethodIds.API_KEY,
    });

    const persistedConnection = await env.controlPlaneDb.query.integrationConnections.findFirst({
      where: (table, { eq }) => eq(table.id, createdConnection.id),
    });
    expect(persistedConnection?.config).toEqual({
      connection_method: IntegrationConnectionMethodIds.API_KEY,
    });
  });
});

async function seedWasenderApiTarget(
  env: Parameters<typeof seedIntegrationTarget>[0],
  targetKey: string,
): Promise<void> {
  await seedIntegrationTarget(env, {
    targetKey,
    familyId: "wasenderapi",
    variantId: "wasenderapi-mcp",
    config: {},
  });
}
