import { describe, expect, it } from "vitest";

import type { EgressCredentialRoute } from "../types/index.js";
import {
  matchesRoute,
  orderRoutesForMatching,
  resolveRouteForRequest,
  routesOverlap,
} from "./index.js";

function createRoute(input: {
  routeId: string;
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
    routeId: input.routeId,
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
  it("matches by host, path prefix, and method", () => {
    const route = createRoute({
      routeId: "route_a",
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
      routeId: "route_openai_v1",
      bindingId: "bind_openai_a",
      hosts: ["api.openai.com"],
      methods: ["POST"],
      pathPrefixes: ["/v1"],
    });
    const right = createRoute({
      routeId: "route_openai_responses",
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
      routeId: "route_generic",
      bindingId: "bind_generic",
      hosts: ["api.github.com", "github.com"],
    });
    const specificRoute = createRoute({
      routeId: "route_specific",
      bindingId: "bind_specific",
      hosts: ["api.github.com"],
      methods: ["GET"],
      pathPrefixes: ["/repos"],
    });

    const orderedRoutes = orderRoutesForMatching([genericRoute, specificRoute]);
    expect(orderedRoutes[0]?.routeId).toBe("route_specific");

    const resolvedRoute = resolveRouteForRequest({
      routes: [genericRoute, specificRoute],
      request: {
        host: "api.github.com",
        path: "/repos/mistlehq/mistle",
        method: "GET",
      },
    });

    expect(resolvedRoute?.routeId).toBe("route_specific");
  });
});
