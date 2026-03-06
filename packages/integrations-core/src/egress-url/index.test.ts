import { describe, expect, it } from "vitest";

import { CompilerErrorCodes, IntegrationCompilerError } from "../errors/index.js";
import { createEgressRouteBaseUrl, EgressUrlRefErrorCodes, resolveEgressUrlRef } from "./index.js";

describe("egress-url helpers", () => {
  it("builds route urls under the sandboxd egress base path", () => {
    expect(
      createEgressRouteBaseUrl({
        egressBaseUrl: "http://127.0.0.1:8090/egress/",
        routeId: "route_bind_linear_connector",
      }),
    ).toBe("http://127.0.0.1:8090/egress/routes/route_bind_linear_connector");
  });

  it("resolves egress refs when the route exists", () => {
    expect(
      resolveEgressUrlRef({
        value: {
          kind: "egress_url",
          routeId: "route_bind_linear_connector",
        },
        routeIds: new Set(["route_bind_linear_connector"]),
        egressBaseUrl: "http://127.0.0.1:8090/egress",
        invalidRefCode: EgressUrlRefErrorCodes.MCP_INVALID_REF,
        refOwner: "MCP server",
      }),
    ).toBe("http://127.0.0.1:8090/egress/routes/route_bind_linear_connector");
  });

  it("fails with the caller-supplied compiler error code when the route is missing", () => {
    expect(() =>
      resolveEgressUrlRef({
        value: {
          kind: "egress_url",
          routeId: "missing_route",
        },
        routeIds: new Set(["route_bind_linear_connector"]),
        egressBaseUrl: "http://127.0.0.1:8090/egress",
        invalidRefCode: EgressUrlRefErrorCodes.RUNTIME_CLIENT_SETUP_INVALID_REF,
        refOwner: "Runtime client setup",
      }),
    ).toThrowError(IntegrationCompilerError);

    try {
      resolveEgressUrlRef({
        value: {
          kind: "egress_url",
          routeId: "missing_route",
        },
        routeIds: new Set(["route_bind_linear_connector"]),
        egressBaseUrl: "http://127.0.0.1:8090/egress",
        invalidRefCode: EgressUrlRefErrorCodes.RUNTIME_CLIENT_SETUP_INVALID_REF,
        refOwner: "Runtime client setup",
      });
    } catch (error) {
      expect(error).toBeInstanceOf(IntegrationCompilerError);
      if (error instanceof IntegrationCompilerError) {
        expect(error.code).toBe(CompilerErrorCodes.RUNTIME_CLIENT_SETUP_INVALID_REF);
      }
    }
  });
});
