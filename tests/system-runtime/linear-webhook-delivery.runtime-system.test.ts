/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended Vitest fixture created by the system test harness.
 */

import { randomBytes, randomUUID } from "node:crypto";

import type { IntegrationWebhookEvent } from "@mistle/db/control-plane";
import {
  IntegrationCredentialSecretKinds,
  IntegrationWebhookSourceStatuses,
} from "@mistle/db/control-plane";
import { LinearManagedWebhookResourceTypes } from "@mistle/integrations-definitions";
import { createSystemTest, type RuntimeSystemTestEnvironment } from "@mistle/test-harness/system";
import { systemSleeper } from "@mistle/time";
import { describe, expect } from "vitest";
import { z } from "zod";

import {
  encryptCredentialUtf8,
  resolveMasterEncryptionKeyMaterial,
  unwrapOrganizationCredentialKey,
} from "../../apps/control-plane-api/src/lib/crypto.js";

const LinearGraphqlEndpoint = "https://api.linear.app/graphql";
const LinearConnectionMethodId = "api-key";
const LinearTargetKey = "linear-default";
const TestTimeoutMs = 180_000;
const PollIntervalMs = 1_000;
const WebhookDeliveryTimeoutMs = 90_000;
const IntegrationMasterEncryptionKeys: Record<string, string> = {
  "1": "integration-new-master-key-testing",
};

const LinearTestApiKey = process.env.LINEAR_TEST_API_KEY;
const LinearTestTeamId = process.env.LINEAR_TEST_TEAM_ID;
const ControlPlaneApiTunnelHostname = process.env.CONTROL_PLANE_API_TUNNEL_HOSTNAME;

const it = createSystemTest({
  services: ["control-plane-api"],
  extraInfra: [],
  publicAccess: {
    provider: "cloudflare",
    services: ["control-plane-api"],
  },
});

const describeIf =
  LinearTestApiKey !== undefined &&
  LinearTestApiKey.trim().length > 0 &&
  LinearTestTeamId !== undefined &&
  LinearTestTeamId.trim().length > 0 &&
  process.env.CLOUDFLARE_TUNNEL_ID !== undefined &&
  process.env.CLOUDFLARE_TUNNEL_ID.trim().length > 0 &&
  process.env.CLOUDFLARE_TUNNEL_CREDENTIALS_JSON !== undefined &&
  process.env.CLOUDFLARE_TUNNEL_CREDENTIALS_JSON.trim().length > 0 &&
  ControlPlaneApiTunnelHostname !== undefined &&
  ControlPlaneApiTunnelHostname.trim().length > 0
    ? describe
    : describe.skip;

describeIf("runtime system Linear webhook delivery", () => {
  it(
    "accepts a real Linear issue webhook through the Cloudflare public control-plane route",
    async ({ system }) => {
      if (LinearTestApiKey === undefined || LinearTestApiKey.trim().length === 0) {
        throw new Error("Missing required environment variable LINEAR_TEST_API_KEY.");
      }
      if (LinearTestTeamId === undefined || LinearTestTeamId.trim().length === 0) {
        throw new Error("Missing required environment variable LINEAR_TEST_TEAM_ID.");
      }
      if (
        ControlPlaneApiTunnelHostname === undefined ||
        ControlPlaneApiTunnelHostname.trim().length === 0
      ) {
        throw new Error("Missing required environment variable CONTROL_PLANE_API_TUNNEL_HOSTNAME.");
      }
      const apiKey = LinearTestApiKey;
      const teamId = LinearTestTeamId;
      const controlPlaneApiTunnelHostname = ControlPlaneApiTunnelHostname;
      const session = await system.env.auth.createSession({
        email: `linear-webhook-delivery-${system.id}@example.com`,
      });
      let connectionId: string | undefined;
      let issueId: string | undefined;
      try {
        const createdConnection = await createLinearConnection({
          system,
          cookie: session.cookie,
          apiKey,
        });
        connectionId = createdConnection.id;

        await createPublicLinearWebhookSource({
          apiKey,
          controlPlaneApiTunnelHostname,
          system,
          connectionId,
          organizationId: session.organizationId,
        });

        const issue = await createLinearIssue({
          apiKey,
          teamId,
          title: `Mistle webhook delivery ${system.id}`,
        });
        issueId = issue.id;

        const persistedEvent = await waitForLinearIssueCreatedEvent({
          system,
          issueId,
        });

        expect(persistedEvent.targetKey).toBe(LinearTargetKey);
        expect(persistedEvent.organizationId).toBe(session.organizationId);
        expect(persistedEvent.integrationConnectionId).toBe(connectionId);
        expect(persistedEvent.providerEventType).toBe("Issue");
        expect(persistedEvent.eventType).toBe("linear.issue.created");
        expect(persistedEvent.status).toBe("received");
      } finally {
        await cleanupLinearWebhookDeliveryResources({
          apiKey,
          connectionId,
          cookie: session.cookie,
          issueId,
          system,
        });
      }
    },
    TestTimeoutMs,
  );
});

async function cleanupLinearWebhookDeliveryResources(input: {
  apiKey: string;
  connectionId: string | undefined;
  cookie: string;
  issueId: string | undefined;
  system: RuntimeSystemTestEnvironment;
}): Promise<void> {
  const errors: unknown[] = [];
  if (input.connectionId !== undefined) {
    try {
      await deleteLinearConnection({
        system: input.system,
        cookie: input.cookie,
        connectionId: input.connectionId,
      });
    } catch (error) {
      errors.push(error);
    }
  }
  if (input.issueId !== undefined) {
    try {
      await archiveLinearIssue({ apiKey: input.apiKey, issueId: input.issueId });
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length > 0) {
    throw new AggregateError(errors, "Failed to clean up Linear webhook delivery resources.");
  }
}

async function deleteLinearConnection(input: {
  system: RuntimeSystemTestEnvironment;
  cookie: string;
  connectionId: string;
}): Promise<void> {
  const response = await input.system.controlPlaneApi.http.fetch(
    `/v1/integration/connections/${encodeURIComponent(input.connectionId)}`,
    {
      method: "DELETE",
      headers: {
        cookie: input.cookie,
      },
    },
  );
  expect(response.status).toBe(200);
}

const CreatedConnectionSchema = z.object({
  id: z.string(),
  managedWebhookSetup: z.object({
    status: z.string(),
    webhookSourceId: z.string().optional(),
    message: z.string().optional(),
  }),
});

async function createLinearConnection(input: {
  system: RuntimeSystemTestEnvironment;
  cookie: string;
  apiKey: string;
}): Promise<z.output<typeof CreatedConnectionSchema>> {
  const response = await input.system.controlPlaneApi.http.fetch(
    `/v1/integration/connections/${encodeURIComponent(LinearTargetKey)}/form`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: input.cookie,
      },
      body: JSON.stringify({
        displayName: "Linear webhook delivery",
        methodId: LinearConnectionMethodId,
        config: {
          connection_method: LinearConnectionMethodId,
        },
        secrets: {
          apiKey: input.apiKey,
        },
      }),
    },
  );

  const body: unknown = await response.json();
  if (response.status !== 201) {
    throw new Error(
      `Expected Linear connection create response status 201, got ${String(
        response.status,
      )}. Body: ${JSON.stringify(body)}`,
    );
  }
  return CreatedConnectionSchema.parse(body);
}

async function createPublicLinearWebhookSource(input: {
  apiKey: string;
  controlPlaneApiTunnelHostname: string;
  system: RuntimeSystemTestEnvironment;
  connectionId: string;
  organizationId: string;
}): Promise<void> {
  const endpointKey = `linear-${randomUUID()}`;
  const callbackUrl = createPublicWebhookCallbackUrl({
    endpointKey,
    environmentId: input.system.id,
    publicHostname: input.controlPlaneApiTunnelHostname,
  });
  expect(callbackUrl).toContain("/__test-environments/");
  expect(callbackUrl).toContain(`/p/integration/webhooks/${LinearTargetKey}/`);

  const webhookSecret = randomBytes(32).toString("hex");
  const createdWebhook = await createLinearWebhook({
    apiKey: input.apiKey,
    url: callbackUrl,
    secret: webhookSecret,
    label: `Mistle test ${input.system.id}`,
  });

  try {
    await persistLinearWebhookSource({
      system: input.system,
      connectionId: input.connectionId,
      organizationId: input.organizationId,
      endpointKey,
      remoteRegistrationId: createdWebhook.id,
      callbackUrl,
      webhookSecret,
    });
  } catch (error) {
    await deleteLinearWebhook({ apiKey: input.apiKey, webhookId: createdWebhook.id });
    throw error;
  }
}

async function persistLinearWebhookSource(input: {
  system: RuntimeSystemTestEnvironment;
  connectionId: string;
  organizationId: string;
  endpointKey: string;
  remoteRegistrationId: string;
  callbackUrl: string;
  webhookSecret: string;
}): Promise<void> {
  const organizationCredentialKey =
    await input.system.env.controlPlaneDb.query.organizationCredentialKeys.findFirst({
      where: (table, { eq }) => eq(table.organizationId, input.organizationId),
      orderBy: (table, { desc }) => [desc(table.version)],
    });
  if (organizationCredentialKey === undefined) {
    throw new Error(`Organization credential key is missing for '${input.organizationId}'.`);
  }

  const masterEncryptionKeyMaterial = resolveMasterEncryptionKeyMaterial({
    masterKeyVersion: organizationCredentialKey.masterKeyVersion,
    masterEncryptionKeys: IntegrationMasterEncryptionKeys,
  });
  const unwrappedOrganizationCredentialKey = unwrapOrganizationCredentialKey({
    wrappedCiphertext: organizationCredentialKey.ciphertext,
    masterEncryptionKeyMaterial,
  });

  try {
    const encryptedSecret = encryptCredentialUtf8({
      plaintext: input.webhookSecret,
      organizationCredentialKey: unwrappedOrganizationCredentialKey,
    });
    const [credential] = await input.system.env.controlPlaneDb
      .insert(input.system.env.controlPlaneTables.integrationCredentials)
      .values({
        organizationId: input.organizationId,
        secretKind: IntegrationCredentialSecretKinds.WEBHOOK_SECRET,
        ciphertext: encryptedSecret.ciphertext,
        nonce: encryptedSecret.nonce,
        organizationCredentialKeyVersion: organizationCredentialKey.version,
        intendedFamilyId: "linear",
      })
      .returning({
        id: input.system.env.controlPlaneTables.integrationCredentials.id,
      });
    if (credential === undefined) {
      throw new Error("Failed to persist Linear webhook secret credential.");
    }

    // The app's configured base URL remains the local runtime URL, matching the GitHub
    // system-test pattern. This test arranges the provider-side callback explicitly so
    // production config does not carry a public tunnel URL just for live webhook tests.
    await input.system.env.controlPlaneDb
      .insert(input.system.env.controlPlaneTables.integrationWebhookSources)
      .values({
        organizationId: input.organizationId,
        integrationConnectionId: input.connectionId,
        targetKey: LinearTargetKey,
        displayName: "Linear webhook delivery",
        endpointKey: input.endpointKey,
        webhookSecretCredentialId: credential.id,
        remoteRegistrationId: input.remoteRegistrationId,
        status: IntegrationWebhookSourceStatuses.ACTIVE,
        providerMetadata: {
          callbackUrl: input.callbackUrl,
          registeredResourceTypes: [...LinearManagedWebhookResourceTypes],
          webhookEnabled: true,
          webhookName: `Mistle test ${input.system.id}`,
        },
      });
  } finally {
    unwrappedOrganizationCredentialKey.fill(0);
  }
}

function createPublicWebhookCallbackUrl(input: {
  endpointKey: string;
  environmentId: string;
  publicHostname: string;
}): string {
  return `https://${input.publicHostname}/__test-environments/${encodeURIComponent(
    input.environmentId,
  )}/p/integration/webhooks/${encodeURIComponent(LinearTargetKey)}/${encodeURIComponent(
    input.endpointKey,
  )}`;
}

const LinearIssueCreateResponseSchema = z.object({
  data: z.object({
    issueCreate: z.object({
      success: z.literal(true),
      issue: z.object({
        id: z.string(),
      }),
    }),
  }),
});

async function createLinearIssue(input: {
  apiKey: string;
  teamId: string;
  title: string;
}): Promise<{ id: string }> {
  const body = await executeLinearGraphql({
    apiKey: input.apiKey,
    query: `
      mutation CreateMistleWebhookDeliveryIssue($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue {
            id
          }
        }
      }
    `,
    variables: {
      input: {
        teamId: input.teamId,
        title: input.title,
        description: "Created by the Mistle Linear webhook delivery system test.",
      },
    },
  });
  const parsed = LinearIssueCreateResponseSchema.parse(body);
  return {
    id: parsed.data.issueCreate.issue.id,
  };
}

const LinearIssueArchiveResponseSchema = z.object({
  data: z.object({
    issueArchive: z.object({
      success: z.literal(true),
    }),
  }),
});

async function archiveLinearIssue(input: { apiKey: string; issueId: string }): Promise<void> {
  const body = await executeLinearGraphql({
    apiKey: input.apiKey,
    query: `
      mutation ArchiveMistleWebhookDeliveryIssue($id: String!) {
        issueArchive(id: $id, trash: true) {
          success
        }
      }
    `,
    variables: {
      id: input.issueId,
    },
  });
  LinearIssueArchiveResponseSchema.parse(body);
}

const LinearWebhookCreateResponseSchema = z.object({
  data: z.object({
    webhookCreate: z.object({
      success: z.literal(true),
      webhook: z.object({
        id: z.string(),
      }),
    }),
  }),
});

async function createLinearWebhook(input: {
  apiKey: string;
  url: string;
  secret: string;
  label: string;
}): Promise<{ id: string }> {
  const body = await executeLinearGraphql({
    apiKey: input.apiKey,
    query: `
      mutation CreateMistleWebhookDeliveryWebhook($input: WebhookCreateInput!) {
        webhookCreate(input: $input) {
          success
          webhook {
            id
          }
        }
      }
    `,
    variables: {
      input: {
        url: input.url,
        label: input.label,
        secret: input.secret,
        allPublicTeams: true,
        resourceTypes: [...LinearManagedWebhookResourceTypes],
      },
    },
  });
  const parsed = LinearWebhookCreateResponseSchema.parse(body);
  return {
    id: parsed.data.webhookCreate.webhook.id,
  };
}

const LinearWebhookDeleteResponseSchema = z.object({
  data: z.object({
    webhookDelete: z.object({
      success: z.literal(true),
    }),
  }),
});

async function deleteLinearWebhook(input: { apiKey: string; webhookId: string }): Promise<void> {
  const body = await executeLinearGraphql({
    apiKey: input.apiKey,
    query: `
      mutation DeleteMistleWebhookDeliveryWebhook($id: String!) {
        webhookDelete(id: $id) {
          success
        }
      }
    `,
    variables: {
      id: input.webhookId,
    },
  });
  LinearWebhookDeleteResponseSchema.parse(body);
}

async function executeLinearGraphql(input: {
  apiKey: string;
  query: string;
  variables: Record<string, unknown>;
}): Promise<unknown> {
  const response = await fetch(LinearGraphqlEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: input.apiKey,
    },
    body: JSON.stringify({
      query: input.query,
      variables: input.variables,
    }),
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    throw new Error(`Linear GraphQL request failed with status ${String(response.status)}.`);
  }
  const errors =
    typeof body === "object" && body !== null ? Reflect.get(body, "errors") : undefined;
  if (errors !== undefined) {
    throw new Error(`Linear GraphQL request failed with errors: ${JSON.stringify(errors)}`);
  }
  return body;
}

async function waitForLinearIssueCreatedEvent(input: {
  system: RuntimeSystemTestEnvironment;
  issueId: string;
}): Promise<IntegrationWebhookEvent> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < WebhookDeliveryTimeoutMs) {
    const events = await input.system.env.controlPlaneDb.query.integrationWebhookEvents.findMany({
      where: (table, { and, eq }) =>
        and(eq(table.targetKey, LinearTargetKey), eq(table.eventType, "linear.issue.created")),
      orderBy: (table, { desc }) => [desc(table.sourceOccurredAt)],
      limit: 20,
    });
    const matchingEvent = events.find(
      (event) => linearWebhookEventIssueId(event) === input.issueId,
    );
    if (matchingEvent !== undefined) {
      return matchingEvent;
    }

    await systemSleeper.sleep(PollIntervalMs);
  }

  const diagnostics = await input.system.publicAccess?.readDiagnostics();
  throw new Error(
    `Timed out waiting for Linear issue webhook '${input.issueId}'. Diagnostics: ${JSON.stringify(
      diagnostics,
    )}`,
  );
}

function linearWebhookEventIssueId(event: IntegrationWebhookEvent): string | undefined {
  const payload = event.payload;
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }
  const data = Reflect.get(payload, "data");
  if (typeof data !== "object" || data === null) {
    return undefined;
  }
  const id = Reflect.get(data, "id");
  return typeof id === "string" ? id : undefined;
}
