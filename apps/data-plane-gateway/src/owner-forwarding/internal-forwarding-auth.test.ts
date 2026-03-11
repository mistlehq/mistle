import { describe, expect, it } from "vitest";

import {
  InternalForwardingHeaderNames,
  createInternalForwardingHeaders,
  verifyInternalForwardingHeaders,
} from "./internal-forwarding-auth.js";

describe("internal forwarding auth", () => {
  it("creates headers that round-trip through verification", () => {
    const headers = createInternalForwardingHeaders({
      serviceToken: "service-token",
      identity: {
        sourceNodeId: "dpg_source",
        targetNodeId: "dpg_target",
      },
    });

    expect(headers.get(InternalForwardingHeaderNames.authorization)).toBe("Bearer service-token");
    expect(headers.get(InternalForwardingHeaderNames.sourceNodeId)).toBe("dpg_source");
    expect(headers.get(InternalForwardingHeaderNames.targetNodeId)).toBe("dpg_target");

    expect(
      verifyInternalForwardingHeaders({
        headers,
        expectedServiceToken: "service-token",
      }),
    ).toEqual({
      sourceNodeId: "dpg_source",
      targetNodeId: "dpg_target",
    });
  });

  it("rejects requests with an invalid service token", () => {
    const headers = new Headers({
      [InternalForwardingHeaderNames.authorization]: "Bearer wrong-token",
      [InternalForwardingHeaderNames.sourceNodeId]: "dpg_source",
      [InternalForwardingHeaderNames.targetNodeId]: "dpg_target",
    });

    expect(() =>
      verifyInternalForwardingHeaders({
        headers,
        expectedServiceToken: "service-token",
      }),
    ).toThrow("Internal forwarding request is missing a valid service token.");
  });

  it("rejects requests missing forwarding node ids", () => {
    const headers = new Headers({
      [InternalForwardingHeaderNames.authorization]: "Bearer service-token",
      [InternalForwardingHeaderNames.sourceNodeId]: "dpg_source",
    });

    expect(() =>
      verifyInternalForwardingHeaders({
        headers,
        expectedServiceToken: "service-token",
      }),
    ).toThrow("Internal forwarding request is missing target gateway node id.");
  });
});
