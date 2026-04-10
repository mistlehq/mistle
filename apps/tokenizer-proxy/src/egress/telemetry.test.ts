import { describe, expect, it } from "vitest";

import {
  createAwsResponseTelemetryAttributes,
  createAwsSigV4TelemetryAttributes,
  createCredentialCacheTelemetryAttributes,
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

  it("emits cache result attributes without leaking credential material", () => {
    expect(
      createCredentialCacheTelemetryAttributes({
        result: "refresh_skew_expired",
      }),
    ).toEqual({
      "mistle.credential.cache.result": "refresh_skew_expired",
    });
  });

  it("builds aws sigv4 request attributes", () => {
    expect(
      createAwsSigV4TelemetryAttributes({
        service: "secretsmanager",
        region: "us-east-1",
        hasBody: true,
        bodyByteLength: 128,
      }),
    ).toEqual({
      "mistle.auth.injection.type": "aws_sigv4",
      "mistle.aws.service": "secretsmanager",
      "mistle.aws.region": "us-east-1",
      "mistle.aws.request.has_body": true,
      "mistle.aws.request.body_bytes": 128,
    });
  });

  it("extracts aws response request ids from safe headers only", () => {
    const headers = new Headers({
      "x-amz-request-id": "req-123",
      "x-amz-id-2": "extended-456",
      "x-amzn-requestid": "amzn-789",
      authorization: "secret",
    });

    expect(
      createAwsResponseTelemetryAttributes({
        headers,
      }),
    ).toEqual({
      "mistle.aws.response.request_id": "req-123",
      "mistle.aws.response.extended_request_id": "extended-456",
      "mistle.aws.response.amzn_request_id": "amzn-789",
    });
  });
});
