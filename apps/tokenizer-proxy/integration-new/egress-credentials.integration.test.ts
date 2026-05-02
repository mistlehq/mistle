/* eslint-disable jest/no-standalone-expect --
 * The test cases use an extended Vitest fixture created by the test harness.
 */

import { IntegrationBindingKinds } from "@mistle/db/control-plane";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import {
  DatadogCredentialSecretTypes,
  DatadogCredentialSlotKeys,
} from "@mistle/integrations-definitions";
import { mintEgressGrant } from "@mistle/sandbox-egress-auth";
import { startHttpEcho } from "@mistle/test-harness";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { EgressRequestHeaders } from "../src/egress/constants.js";

const EgressGrantConfig = {
  tokenSecret: "integration-new-egress-token-secret",
  tokenIssuer: "integration-new-data-plane-worker",
  tokenAudience: "integration-new-tokenizer-proxy",
} as const;

const it = createIntegrationTest({
  services: ["control-plane-api", "tokenizer-proxy"],
});

describe.concurrent("tokenizer proxy egress credentials", () => {
  it("resolves connection credentials through the real control-plane API", async ({ env }) => {
    const upstreamEchoService = await startHttpEcho();

    try {
      const session = await env.auth.createSession({
        email: "integration-new-tokenizer-proxy@example.com",
      });
      const targetKey = "datadog-default";
      const bindingId = "ibd_integration_new_tokenizer_proxy_datadog";
      const connectionId = await createDatadogConnection({
        targetKey,
        cookie: session.cookie,
        env,
      });

      await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values({
        id: "sbp_integration_new_tokenizer_proxy",
        organizationId: session.organizationId,
        displayName: "Tokenizer proxy integration-new profile",
      });
      await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values({
        sandboxProfileId: "sbp_integration_new_tokenizer_proxy",
        version: 1,
      });
      await env.controlPlaneDb
        .insert(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
        .values({
          id: bindingId,
          sandboxProfileId: "sbp_integration_new_tokenizer_proxy",
          sandboxProfileVersion: 1,
          connectionId,
          kind: IntegrationBindingKinds.AGENT,
          config: {},
        });

      const egressGrant = await mintEgressGrant({
        config: EgressGrantConfig,
        claims: {
          sub: "sbi_integration_new_tokenizer_proxy",
          jti: "egress_rule_integration_new_datadog",
          bindingId,
          organizationId: session.organizationId,
          familyId: "datadog",
          variantId: "datadog-default",
          credentialResolverKind: "integration_connection",
          connectionId,
          secretType: DatadogCredentialSecretTypes.API_KEY,
          slotKey: DatadogCredentialSlotKeys.API_KEY,
          upstreamBaseUrl: upstreamEchoService.baseUrl,
          authInjectionType: "header",
          authInjectionTarget: "dd_api_key",
          additionalCredentialHeaders: [
            {
              header: "dd_application_key",
              credentialResolver: {
                kind: "integration_connection",
                connectionId,
                secretType: DatadogCredentialSecretTypes.API_KEY,
                slotKey: DatadogCredentialSlotKeys.APPLICATION_KEY,
              },
            },
          ],
          allowedMethods: ["GET"],
          allowedPathPrefixes: ["/mcp"],
        },
        ttlSeconds: 60,
      });

      const response = await env.tokenizerProxy.http.fetch("/tokenizer-proxy/egress/mcp", {
        method: "GET",
        headers: {
          [EgressRequestHeaders.GRANT]: egressGrant,
        },
      });
      const body: unknown = await response.json();

      expect(response.status).toBe(200);
      expect(readEchoHeader(body, "dd_api_key")).toBe("datadog-api-key");
      expect(readEchoHeader(body, "dd_application_key")).toBe("datadog-application-key");
    } finally {
      await upstreamEchoService.stop();
    }
  });
});

async function createDatadogConnection(input: {
  targetKey: string;
  cookie: string;
  env: IntegrationTestEnvironment;
}): Promise<string> {
  const integrationTargets = input.env.controlPlaneTables.integrationTargets;

  await input.env.controlPlaneDb
    .insert(integrationTargets)
    .values({
      targetKey: input.targetKey,
      familyId: "datadog",
      variantId: "datadog-default",
      enabled: true,
      config: {},
    })
    .onConflictDoUpdate({
      target: integrationTargets.targetKey,
      set: {
        familyId: "datadog",
        variantId: "datadog-default",
        enabled: true,
        config: {},
      },
    });

  const response = await input.env.controlPlaneApi.http.fetch(
    `/v1/integration/connections/${input.targetKey}/form`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: input.cookie,
      },
      body: JSON.stringify({
        displayName: "Integration-new Datadog connection",
        methodId: IntegrationConnectionMethodIds.API_KEY,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
        secrets: {
          apiKey: "datadog-api-key",
          applicationKey: "datadog-application-key",
        },
      }),
    },
  );

  if (response.status !== 201) {
    throw new Error(
      `Expected Datadog connection creation status 201, got ${String(response.status)}.`,
    );
  }

  return readConnectionId(await response.json());
}

function readConnectionId(value: unknown): string {
  if (!isRecord(value)) {
    throw new Error("Expected connection response to be a JSON object.");
  }

  const id = value["id"];
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("Expected connection response to include an id.");
  }

  return id;
}

function readEchoHeader(body: unknown, headerName: string): string | undefined {
  if (!isRecord(body)) {
    throw new Error("Expected echo response body to be a JSON object.");
  }

  const headers = body["headers"];
  if (!isRecord(headers)) {
    throw new Error("Expected echo response body to include headers.");
  }

  const value = headers[headerName] ?? headers[headerName.toLowerCase()];
  if (Array.isArray(value)) {
    const firstValue = value[0];
    return typeof firstValue === "string" ? firstValue : undefined;
  }

  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
