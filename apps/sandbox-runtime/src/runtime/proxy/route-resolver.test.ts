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

const RootPathRoute: EgressCredentialRoute = {
  ...OpenAiRoute,
  egressRuleId: "egress_rule_root",
  bindingId: "ibd_root",
  match: {
    ...OpenAiRoute.match,
    pathPrefixes: ["/"],
  },
  credentialResolver: {
    connectionId: "icn_root",
    secretType: "api_key",
  },
};

const TrailingSlashRoute: EgressCredentialRoute = {
  ...OpenAiRoute,
  egressRuleId: "egress_rule_trailing_slash",
  bindingId: "ibd_trailing_slash",
  match: {
    ...OpenAiRoute.match,
    pathPrefixes: ["/v1/"],
  },
  credentialResolver: {
    connectionId: "icn_trailing_slash",
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

  it("matches an exact path prefix boundary", () => {
    expect(
      resolveMatchingEgressRoute({
        routes: [OpenAiRoute],
        host: "api.openai.com",
        method: "POST",
        targetPath: "/v1",
      }),
    ).toEqual(OpenAiRoute);
  });

  it("does not match sibling paths that only share a string prefix", () => {
    expect(
      resolveMatchingEgressRoute({
        routes: [OpenAiRoute],
        host: "api.openai.com",
        method: "POST",
        targetPath: "/v10/responses",
      }),
    ).toBeUndefined();

    expect(
      resolveMatchingEgressRoute({
        routes: [OpenAiRoute],
        host: "api.openai.com",
        method: "POST",
        targetPath: "/v1foo",
      }),
    ).toBeUndefined();
  });

  it("treats a root path prefix as matching all normalized paths", () => {
    expect(
      resolveMatchingEgressRoute({
        routes: [RootPathRoute],
        host: "api.openai.com",
        method: "POST",
        targetPath: "",
      }),
    ).toEqual(RootPathRoute);

    expect(
      resolveMatchingEgressRoute({
        routes: [RootPathRoute],
        host: "api.openai.com",
        method: "POST",
        targetPath: "/v1/responses",
      }),
    ).toEqual(RootPathRoute);
  });

  it("normalizes configured trailing slashes before matching descendants", () => {
    expect(
      resolveMatchingEgressRoute({
        routes: [TrailingSlashRoute],
        host: "api.openai.com",
        method: "POST",
        targetPath: "/v1",
      }),
    ).toEqual(TrailingSlashRoute);

    expect(
      resolveMatchingEgressRoute({
        routes: [TrailingSlashRoute],
        host: "api.openai.com",
        method: "POST",
        targetPath: "/v1/responses",
      }),
    ).toEqual(TrailingSlashRoute);
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
