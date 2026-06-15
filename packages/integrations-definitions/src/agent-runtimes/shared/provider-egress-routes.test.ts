import type { EgressCredentialRoute } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import {
  isAnthropicApiRoute,
  isDeepSeekApiRoute,
  isFireworksApiRoute,
  isIntegrationConnectionCredentialRoute,
  isKimiApiRoute,
  isMiniMaxApiRoute,
  isMiniMaxOpenCodeApiRoute,
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

  it("matches DeepSeek API provider routes", () => {
    expect(
      isDeepSeekApiRoute(
        createRoute({
          familyId: "deepseek",
          host: "api.deepseek.com",
        }),
      ),
    ).toBe(true);
  });

  it("matches Fireworks AI provider routes", () => {
    expect(
      isFireworksApiRoute(
        createRoute({
          familyId: "fireworks",
          host: "api.fireworks.ai",
          baseUrl: "https://api.fireworks.ai/inference/v1",
          pathPrefixes: ["/inference/v1"],
        }),
      ),
    ).toBe(true);
  });

  it("matches Kimi API provider routes", () => {
    expect(
      isKimiApiRoute(
        createRoute({
          familyId: "kimi",
          host: "api.moonshot.ai",
          baseUrl: "https://api.moonshot.ai/v1",
          pathPrefixes: ["/v1"],
        }),
      ),
    ).toBe(true);
  });

  it("matches MiniMax API provider routes", () => {
    expect(
      isMiniMaxApiRoute(
        createRoute({
          familyId: "minimax",
          host: "api.minimaxi.com",
          baseUrl: "https://api.minimaxi.com/v1",
          pathPrefixes: ["/v1"],
        }),
      ),
    ).toBe(true);

    expect(
      isMiniMaxOpenCodeApiRoute(
        createRoute({
          familyId: "minimax",
          host: "api.minimaxi.com",
          baseUrl: "https://api.minimaxi.com/anthropic/v1",
          pathPrefixes: ["/anthropic/v1"],
          authInjectionType: "header",
          authInjectionTarget: "x-api-key",
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
