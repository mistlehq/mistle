import { describe, expect, it } from "vitest";

import {
  createEgressTelemetryBaseAttributes,
  createUpstreamTelemetryAttributes,
} from "./telemetry.js";

describe("tokenizer proxy egress telemetry helpers", () => {
  it("builds non-sensitive base attributes for egress spans", () => {
    expect(
      createEgressTelemetryBaseAttributes({
        egressRuleId: "egress_rule_github_graphql",
        method: "POST",
        requestPath: "/tokenizer-proxy/egress/graphql",
        bindingId: "ibd_github",
        connectionId: "icn_github",
      }),
    ).toEqual({
      "mistle.egress.rule_id": "egress_rule_github_graphql",
      "mistle.integration.binding_id": "ibd_github",
      "mistle.integration.connection_id": "icn_github",
      "http.request.method": "POST",
      "url.path": "/tokenizer-proxy/egress/graphql",
    });
  });

  it("extracts host and path attributes from the upstream url", () => {
    expect(
      createUpstreamTelemetryAttributes({
        upstreamUrl: new URL("https://api.github.com/graphql?query=secret"),
      }),
    ).toEqual({
      "server.address": "api.github.com",
      "url.path": "/graphql",
    });
  });
});
