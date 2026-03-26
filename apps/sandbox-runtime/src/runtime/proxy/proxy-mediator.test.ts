import type { CompiledRuntimePlan } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { createProxyMediator } from "./proxy-mediator.js";

function createRuntimePlan(): CompiledRuntimePlan {
  return {
    sandboxProfileId: "sbp_proxy_test",
    version: 1,
    image: {
      source: "base",
      imageRef: "mistle/sandbox-base:dev",
    },
    egressRoutes: [
      {
        egressRuleId: "egress_rule_openai",
        bindingId: "ibd_openai",
        match: {
          hosts: ["api.openai.com"],
          pathPrefixes: ["/v1"],
          methods: ["POST"],
        },
        upstream: {
          baseUrl: "https://api.openai.com/v1",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          connectionId: "icn_openai",
          secretType: "api_key",
          purpose: "api_key",
          resolverKey: "default",
        },
      },
    ],
    artifacts: [],
    runtimeClients: [],
    workspaceSources: [],
    agentRuntimes: [],
  };
}

describe("createProxyMediator", () => {
  it("returns an explicit passthrough decision when no egress route matches", () => {
    const mediator = createProxyMediator({
      runtimePlan: createRuntimePlan(),
      tokenizerProxyEgressBaseUrl: "http://127.0.0.1:5000/tokenizer-proxy/egress",
    });

    expect(
      mediator.resolve(
        {
          host: "registry.npmjs.org",
          method: "GET",
          path: "/pnpm",
        },
        {
          headers: {},
          body: undefined,
          rawQuery: "",
        },
      ),
    ).toEqual({
      kind: "passthrough",
    });
  });

  it("returns an explicit mediated decision when an egress route matches", () => {
    const mediator = createProxyMediator({
      runtimePlan: createRuntimePlan(),
      tokenizerProxyEgressBaseUrl: "http://127.0.0.1:5000/tokenizer-proxy/egress",
    });

    const decision = mediator.resolve(
      {
        host: "api.openai.com",
        method: "POST",
        path: "/v1/responses",
      },
      {
        headers: {
          "content-type": "application/json",
        },
        body: undefined,
        rawQuery: "stream=true",
      },
    );

    expect(decision.kind).toBe("mediated");
    if (decision.kind !== "mediated") {
      throw new Error("expected mediated proxy routing decision");
    }

    expect(decision.match.route.egressRuleId).toBe("egress_rule_openai");
    expect(decision.match.request.url.toString()).toBe(
      "http://127.0.0.1:5000/tokenizer-proxy/egress/v1/responses?stream=true",
    );
  });
});
