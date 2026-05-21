import type { EgressCredentialRoute } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import {
  isAnthropicApiRoute,
  isIntegrationConnectionCredentialRoute,
  isOpenAiApiRoute,
  isOpenAiChatGptSubscriptionRoute,
  isOpenCodeGoRoute,
  routeHasHost,
  routeHasPathPrefix,
} from "./provider-egress-routes.js";

function createRoute(input: {
  familyId: string;
  host: string;
  baseUrl?: string;
  pathPrefixes?: ReadonlyArray<string>;
  authInjectionType?: "bearer" | "basic" | "header" | "query";
  authInjectionTarget?: string;
  credentialResolver?: EgressCredentialRoute["credentialResolver"];
}): EgressCredentialRoute {
  return {
    egressRuleId: "egress_route_1",
    bindingId: "binding_1",
    familyId: input.familyId,
    variantId: `${input.familyId}-default`,
    match: {
      hosts: [input.host],
      ...(input.pathPrefixes === undefined ? {} : { pathPrefixes: input.pathPrefixes }),
    },
    upstream: {
      baseUrl: input.baseUrl ?? `https://${input.host}`,
    },
    authInjection: {
      type: input.authInjectionType ?? "bearer",
      target: input.authInjectionTarget ?? "authorization",
    },
    credentialResolver: input.credentialResolver ?? {
      kind: "integration_connection",
      connectionId: "connection_1",
      secretType: "api_key",
    },
  };
}

describe("provider egress route helpers", () => {
  it("matches route hosts case-insensitively", () => {
    const route = createRoute({
      familyId: "openai",
      host: "API.OPENAI.COM",
    });

    expect(routeHasHost({ route, host: "api.openai.com" })).toBe(true);
  });

  it("matches route path prefixes from either upstream base URL or route match config", () => {
    expect(
      routeHasPathPrefix({
        route: createRoute({
          familyId: "opencode",
          host: "opencode.ai",
          baseUrl: "https://opencode.ai/zen/go",
        }),
        pathPrefix: "/zen/go",
      }),
    ).toBe(true);

    expect(
      routeHasPathPrefix({
        route: createRoute({
          familyId: "opencode",
          host: "opencode.ai",
          pathPrefixes: ["/zen/go"],
        }),
        pathPrefix: "/zen/go",
      }),
    ).toBe(true);
  });

  it("narrows integration connection credential routes", () => {
    const route = createRoute({
      familyId: "openai",
      host: "api.openai.com",
    });

    expect(isIntegrationConnectionCredentialRoute(route)).toBe(true);
    if (!isIntegrationConnectionCredentialRoute(route)) {
      throw new Error("Expected integration connection route.");
    }
    expect(route.credentialResolver.secretType).toBe("api_key");
  });

  it("matches OpenAI API and ChatGPT subscription provider routes", () => {
    expect(
      isOpenAiApiRoute(
        createRoute({
          familyId: "openai",
          host: "api.openai.com",
        }),
      ),
    ).toBe(true);

    expect(
      isOpenAiChatGptSubscriptionRoute(
        createRoute({
          familyId: "openai",
          host: "chatgpt.com",
          credentialResolver: {
            kind: "integration_connection",
            connectionId: "connection_1",
            secretType: "chatgpt_access_token",
          },
        }),
      ),
    ).toBe(true);
  });

  it("rejects OpenAI routes with incompatible credential shape", () => {
    expect(
      isOpenAiApiRoute(
        createRoute({
          familyId: "openai",
          host: "api.openai.com",
          credentialResolver: {
            kind: "linked_principal",
            providerFamily: "openai",
            integrationConnectionId: "icn_openai",
            actingUserRequired: true,
            resolutionMode: "required",
          },
        }),
      ),
    ).toBe(false);

    expect(
      isOpenAiChatGptSubscriptionRoute(
        createRoute({
          familyId: "openai",
          host: "chatgpt.com",
          credentialResolver: {
            kind: "integration_connection",
            connectionId: "connection_1",
            secretType: "api_key",
          },
        }),
      ),
    ).toBe(false);
  });

  it("matches Anthropic API and OpenCode Go provider routes", () => {
    expect(
      isAnthropicApiRoute(
        createRoute({
          familyId: "anthropic",
          host: "api.anthropic.com",
          authInjectionType: "header",
          authInjectionTarget: "x-api-key",
        }),
      ),
    ).toBe(true);

    expect(
      isOpenCodeGoRoute(
        createRoute({
          familyId: "opencode",
          host: "opencode.ai",
          baseUrl: "https://opencode.ai/zen/go",
        }),
      ),
    ).toBe(true);
  });

  it("rejects Anthropic API routes with incompatible auth injection", () => {
    expect(
      isAnthropicApiRoute(
        createRoute({
          familyId: "anthropic",
          host: "api.anthropic.com",
        }),
      ),
    ).toBe(false);
  });
});
