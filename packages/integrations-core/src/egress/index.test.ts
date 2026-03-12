import { describe, expect, it } from "vitest";

import type { EgressCredentialRoute } from "../types/index.js";
import {
  joinRoutePathPrefixes,
  matchesRoute,
  orderRoutesForMatching,
  resolveRoutePathPrefixFromBaseUrl,
  resolveRouteForRequest,
  routesOverlap,
} from "./index.js";

function createRoute(input: {
  egressRuleId: string;
  bindingId: string;
  hosts: string[];
  methods?: string[];
  pathPrefixes?: string[];
}): EgressCredentialRoute {
  const match: EgressCredentialRoute["match"] = {
    hosts: input.hosts,
  };

  if (input.methods !== undefined) {
    match.methods = input.methods;
  }

  if (input.pathPrefixes !== undefined) {
    match.pathPrefixes = input.pathPrefixes;
  }

  return {
    egressRuleId: input.egressRuleId,
    bindingId: input.bindingId,
    match,
    upstream: {
      baseUrl: "https://api.example.com",
    },
    authInjection: {
      type: "bearer",
      target: "authorization",
    },
    credentialResolver: {
      connectionId: "conn_123",
      secretType: "api_key",
    },
  };
}

describe("egress route matching", () => {
  it("resolves root URLs to '/' path prefix", () => {
    expect(resolveRoutePathPrefixFromBaseUrl("https://api.openai.com")).toBe("/");
    expect(resolveRoutePathPrefixFromBaseUrl("https://api.openai.com/")).toBe("/");
  });

  it("resolves non-root URLs by trimming only trailing slash", () => {
    expect(resolveRoutePathPrefixFromBaseUrl("https://proxy.example.com/openai-v2/")).toBe(
      "/openai-v2",
    );
    expect(resolveRoutePathPrefixFromBaseUrl("https://proxy.example.com/openai-v2")).toBe(
      "/openai-v2",
    );
  });

  it("joins route path prefixes without introducing double slashes", () => {
    expect(joinRoutePathPrefixes("/", "/repos/acme/repo")).toBe("/repos/acme/repo");
    expect(joinRoutePathPrefixes("/api/v3", "/repos/acme/repo")).toBe("/api/v3/repos/acme/repo");
  });

  it("matches by host, path prefix, and method", () => {
    const route = createRoute({
      egressRuleId: "egress_rule_a",
      bindingId: "bind_openai",
      hosts: ["api.openai.com"],
      methods: ["POST"],
      pathPrefixes: ["/v1"],
    });

    const doesMatch = matchesRoute({
      route,
      request: {
        host: "api.openai.com",
        path: "/v1/responses",
        method: "post",
      },
    });

    expect(doesMatch).toBe(true);
  });

  it("detects overlapping routes", () => {
    const left = createRoute({
      egressRuleId: "egress_rule_openai_v1",
      bindingId: "bind_openai_a",
      hosts: ["api.openai.com"],
      methods: ["POST"],
      pathPrefixes: ["/v1"],
    });
    const right = createRoute({
      egressRuleId: "egress_rule_openai_responses",
      bindingId: "bind_openai_b",
      hosts: ["api.openai.com"],
      methods: ["POST"],
      pathPrefixes: ["/v1/responses"],
    });

    expect(
      routesOverlap({
        left,
        right,
      }),
    ).toBe(true);
  });

  it("orders routes by specificity for deterministic matching", () => {
    const genericRoute = createRoute({
      egressRuleId: "egress_rule_generic",
      bindingId: "bind_generic",
      hosts: ["api.github.com", "github.com"],
    });
    const specificRoute = createRoute({
      egressRuleId: "egress_rule_specific",
      bindingId: "bind_specific",
      hosts: ["api.github.com"],
      methods: ["GET"],
      pathPrefixes: ["/repos"],
    });

    const orderedRoutes = orderRoutesForMatching([genericRoute, specificRoute]);
    expect(orderedRoutes[0]?.egressRuleId).toBe("egress_rule_specific");

    const resolvedRoute = resolveRouteForRequest({
      routes: [genericRoute, specificRoute],
      request: {
        host: "api.github.com",
        path: "/repos/mistlehq/mistle",
        method: "GET",
      },
    });

    expect(resolvedRoute?.egressRuleId).toBe("egress_rule_specific");
  });
});
