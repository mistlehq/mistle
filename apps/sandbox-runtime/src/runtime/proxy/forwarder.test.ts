import type { EgressCredentialRoute } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { buildTokenizerProxyRequest, HEADER_EGRESS_RULE_ID } from "./forwarder.js";

const OpenAiRoute: EgressCredentialRoute = {
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
};

describe("buildTokenizerProxyRequest", () => {
  it("uses header-addressed tokenizer path and forwards route metadata", () => {
    const request = buildTokenizerProxyRequest({
      tokenizerProxyEgressBaseUrl: "http://tokenizer-proxy.internal/tokenizer-proxy/egress",
      runtimePlan: {
        sandboxProfileId: "sbp_test",
        version: 7,
      },
      route: OpenAiRoute,
      targetPath: "/v1/responses",
      rawQuery: "stream=true",
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: undefined,
    });

    expect(request.url.pathname).toBe("/tokenizer-proxy/egress/v1/responses");
    expect(request.url.search).toBe("?stream=true");
    expect(request.headers[HEADER_EGRESS_RULE_ID]).toBe("egress_rule_openai");
  });
});
