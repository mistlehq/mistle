/* eslint-disable jest/no-standalone-expect --
 * The test cases use an extended Vitest fixture created by the test harness.
 */

import { mintEgressGrant } from "@mistle/sandbox-egress-auth";
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

type TokenizerProxyHttpResponse = Awaited<
  ReturnType<IntegrationTestEnvironment["tokenizerProxy"]["http"]["fetch"]>
>;

describe.concurrent("tokenizer proxy egress authorization", () => {
  it("serves health checks through the integration harness", async ({ env }) => {
    const response = await env.tokenizerProxy.http.fetch("/__healthz");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("rejects egress requests without a grant", async ({ env }) => {
    const response = await env.tokenizerProxy.http.fetch("/tokenizer-proxy/egress/v1/responses", {
      method: "POST",
    });

    await expectProxyErrorResponse(response, {
      status: 401,
      code: "INVALID_EGRESS_GRANT",
      message: "Egress grant token is required.",
    });
  });

  it("ignores forged authority headers when no grant is present", async ({ env }) => {
    const response = await env.tokenizerProxy.http.fetch("/tokenizer-proxy/egress/v1/responses", {
      method: "POST",
      headers: {
        "x-mistle-egress-binding-id": "ibd_forged",
        "x-mistle-egress-connection-id": "icn_forged",
        "x-mistle-egress-upstream-base-url": "https://attacker.invalid",
      },
    });

    await expectProxyErrorResponse(response, {
      status: 401,
      code: "INVALID_EGRESS_GRANT",
      message: "Egress grant token is required.",
    });
  });

  it("rejects requests with methods outside the grant scope before resolving credentials", async ({
    env,
  }) => {
    const egressGrant = await mintScopedEgressGrant({
      allowedMethods: ["POST"],
      allowedPathPrefixes: ["/v1"],
    });

    const response = await env.tokenizerProxy.http.fetch("/tokenizer-proxy/egress/v1/responses", {
      method: "GET",
      headers: {
        [EgressRequestHeaders.GRANT]: egressGrant,
      },
    });

    await expectProxyErrorResponse(response, {
      status: 403,
      code: "EGRESS_GRANT_SCOPE_VIOLATION",
      message: "Egress grant does not allow method 'GET'.",
    });
  });

  it("rejects requests with paths outside the grant scope before resolving credentials", async ({
    env,
  }) => {
    const egressGrant = await mintScopedEgressGrant({
      allowedMethods: ["POST"],
      allowedPathPrefixes: ["/v1"],
    });

    const response = await env.tokenizerProxy.http.fetch("/tokenizer-proxy/egress/graphql", {
      method: "POST",
      headers: {
        [EgressRequestHeaders.GRANT]: egressGrant,
      },
    });

    await expectProxyErrorResponse(response, {
      status: 403,
      code: "EGRESS_GRANT_SCOPE_VIOLATION",
      message: "Egress grant does not allow path '/graphql'.",
    });
  });
});

async function mintScopedEgressGrant(input: {
  allowedMethods: readonly string[];
  allowedPathPrefixes: readonly string[];
}): Promise<string> {
  return await mintEgressGrant({
    config: EgressGrantConfig,
    claims: {
      sub: "sbi_integration_new_tokenizer_proxy_authorization",
      jti: `egress_rule_integration_new_${crypto.randomUUID()}`,
      bindingId: "ibd_integration_new_tokenizer_proxy_authorization",
      organizationId: "org_integration_new_tokenizer_proxy_authorization",
      familyId: "openai",
      variantId: "openai-default",
      credentialResolverKind: "integration_connection",
      connectionId: "icn_integration_new_tokenizer_proxy_authorization",
      secretType: "api_key",
      upstreamBaseUrl: "https://api.openai.com",
      authInjectionType: "bearer",
      authInjectionTarget: "authorization",
      allowedMethods: input.allowedMethods,
      allowedPathPrefixes: input.allowedPathPrefixes,
    },
    ttlSeconds: 60,
  });
}

async function expectProxyErrorResponse(
  response: TokenizerProxyHttpResponse,
  input: {
    status: number;
    code: string;
    message: string;
  },
): Promise<void> {
  const body: unknown = await response.json();

  expect(response.status).toBe(input.status);
  expect(body).toMatchObject({
    code: input.code,
    message: input.message,
  });
  if (typeof body !== "object" || body === null || !("traceId" in body)) {
    throw new Error("Expected proxy error body to include traceId.");
  }

  const bodyTraceId = body.traceId;
  expect(typeof bodyTraceId).toBe("string");
  expect(bodyTraceId).toMatch(/^[0-9a-f]{32}$/u);
  expect(response.headers.get("x-mistle-trace-id")).toBe(bodyTraceId);
}
