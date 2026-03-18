import type { EgressCredentialRoute } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { resolveMatchingEgressRoute } from "./route-resolver.js";

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
  },
};

describe("resolveMatchingEgressRoute", () => {
  it("matches host method and path prefix", () => {
    expect(
      resolveMatchingEgressRoute({
        routes: [OpenAiRoute],
        host: "api.openai.com:443",
        method: "POST",
        targetPath: "/v1/responses",
      }),
    ).toEqual(OpenAiRoute);
  });

  it("returns undefined when no route matches", () => {
    expect(
      resolveMatchingEgressRoute({
        routes: [OpenAiRoute],
        host: "api.anthropic.com",
        method: "POST",
        targetPath: "/v1/messages",
      }),
    ).toBeUndefined();
  });

  it("fails closed when multiple routes match", () => {
    expect(() =>
      resolveMatchingEgressRoute({
        routes: [
          OpenAiRoute,
          {
            ...OpenAiRoute,
            egressRuleId: "egress_rule_openai_duplicate",
            bindingId: "ibd_openai_duplicate",
            credentialResolver: {
              connectionId: "icn_openai_duplicate",
              secretType: "api_key",
            },
          },
        ],
        host: "api.openai.com",
        method: "POST",
        targetPath: "/v1/responses",
      }),
    ).toThrow(
      'multiple egress routes matched host="api.openai.com" method="POST" path="/v1/responses"',
    );
  });
});
