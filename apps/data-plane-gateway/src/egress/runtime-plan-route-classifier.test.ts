import type { CompiledRuntimePlan } from "@mistle/sandbox-runtime-contract";
import { describe, expect, it } from "vitest";

import { classifyRuntimePlanEgressRoute } from "./runtime-plan-route-classifier.js";

describe("classifyRuntimePlanEgressRoute", () => {
  it("returns unmatched when no runtime-plan route covers the request host", () => {
    const classification = classifyRuntimePlanEgressRoute({
      authority: "example.com",
      method: "GET",
      path: "/v1/models",
      runtimePlan: createRuntimePlan({
        egressRoutes: [
          createRoute({
            egressRuleId: "egress_rule_openai",
            hosts: ["api.openai.com"],
            pathPrefixes: ["/v1"],
            methods: ["GET"],
          }),
        ],
      }),
    });

    expect(classification).toEqual({ kind: "unmatched" });
  });

  it("matches by host, method, and path prefix without trusting request-supplied route state", () => {
    const classification = classifyRuntimePlanEgressRoute({
      authority: "api.openai.com:443",
      method: "post",
      path: "/v1/responses",
      runtimePlan: createRuntimePlan({
        egressRoutes: [
          createRoute({
            egressRuleId: "egress_rule_openai",
            hosts: ["api.openai.com"],
            pathPrefixes: ["/v1"],
            methods: ["POST"],
          }),
        ],
      }),
    });

    expect(classification).toMatchObject({
      kind: "matched",
      route: {
        egressRuleId: "egress_rule_openai",
      },
    });
  });

  it("does not match sibling paths that only share a string prefix", () => {
    const classification = classifyRuntimePlanEgressRoute({
      authority: "mcp.pscale.dev",
      method: "POST",
      path: "/mcp/planetscale-insights-only",
      runtimePlan: createRuntimePlan({
        egressRoutes: [
          createRoute({
            egressRuleId: "egress_rule_planetscale",
            hosts: ["mcp.pscale.dev"],
            pathPrefixes: ["/mcp/planetscale"],
          }),
        ],
      }),
    });

    expect(classification).toEqual({ kind: "unmatched" });
  });

  it("matches child paths under the declared path prefix", () => {
    const classification = classifyRuntimePlanEgressRoute({
      authority: "mcp.pscale.dev",
      method: "POST",
      path: "/mcp/planetscale/tools/list",
      runtimePlan: createRuntimePlan({
        egressRoutes: [
          createRoute({
            egressRuleId: "egress_rule_planetscale",
            hosts: ["mcp.pscale.dev"],
            pathPrefixes: ["/mcp/planetscale"],
          }),
        ],
      }),
    });

    expect(classification).toMatchObject({
      kind: "matched",
      route: {
        egressRuleId: "egress_rule_planetscale",
      },
    });
  });

  it("returns ambiguous when more than one runtime-plan route matches the request", () => {
    const classification = classifyRuntimePlanEgressRoute({
      authority: "api.openai.com",
      method: "POST",
      path: "/v1/responses",
      runtimePlan: createRuntimePlan({
        egressRoutes: [
          createRoute({
            egressRuleId: "egress_rule_broad",
            hosts: ["api.openai.com"],
            pathPrefixes: ["/"],
          }),
          createRoute({
            egressRuleId: "egress_rule_specific",
            hosts: ["api.openai.com"],
            pathPrefixes: ["/v1"],
            methods: ["POST"],
          }),
        ],
      }),
    });

    expect(classification).toMatchObject({
      kind: "ambiguous",
      routes: [
        {
          egressRuleId: "egress_rule_broad",
        },
        {
          egressRuleId: "egress_rule_specific",
        },
      ],
    });
  });
});

function createRuntimePlan(input: {
  egressRoutes: CompiledRuntimePlan["egressRoutes"];
}): CompiledRuntimePlan {
  return {
    sandboxProfileId: "sbp_route_classification",
    version: 1,
    image: {
      source: "base",
      imageRef: "sandbox-base",
    },
    egressRoutes: input.egressRoutes,
    artifacts: [],
    workspaceSources: [],
    runtimeClients: [],
    agentRuntimes: [],
  };
}

function createRoute(input: {
  egressRuleId: string;
  hosts: string[];
  pathPrefixes?: string[];
  methods?: string[];
}): CompiledRuntimePlan["egressRoutes"][number] {
  return {
    egressRuleId: input.egressRuleId,
    bindingId: `bind_${input.egressRuleId}`,
    familyId: "openai",
    variantId: "openai-default",
    match: {
      hosts: input.hosts,
      ...(input.pathPrefixes === undefined ? {} : { pathPrefixes: input.pathPrefixes }),
      ...(input.methods === undefined ? {} : { methods: input.methods }),
    },
    upstream: {
      baseUrl: `https://${input.hosts[0]}`,
    },
    authInjection: {
      type: "bearer",
      target: "authorization",
    },
    credentialResolver: {
      kind: "integration_connection",
      connectionId: "ic_openai",
      secretType: "api_token",
    },
  };
}
