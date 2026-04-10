import { describe, expect, it } from "vitest";

import {
  createAwsResponseTelemetryAttributes,
  createAwsSigV4TelemetryAttributes,
} from "./egress-telemetry.server.js";

describe("aws egress telemetry helpers", () => {
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
