import {
  ClosedConnectionError,
  DrainingConnectionError,
  NoRespondersError,
  RequestError,
} from "@nats-io/transport-node";
import { describe, expect, it } from "vitest";

import {
  GatewayForwardingPortAccessAuthorizationErrorCodes,
  GatewayForwardingUnavailableError,
  type GatewayForwardingTarget,
} from "../types.js";
import {
  remoteGatewayUnavailableReason,
  toPortAccessForwardingRequestError,
} from "./nats-gateway-forwarding-adapter.js";

describe("NATS gateway forwarding error handling", () => {
  it("classifies unavailable NATS request errors", () => {
    expect(remoteGatewayUnavailableReason(new NoRespondersError("test.subject"))).toBe(
      "no_responders",
    );
    expect(remoteGatewayUnavailableReason(new ClosedConnectionError())).toBe("connection_closed");
    expect(remoteGatewayUnavailableReason(new DrainingConnectionError())).toBe(
      "connection_draining",
    );
    expect(remoteGatewayUnavailableReason(new Error("unrelated"))).toBeUndefined();
  });

  it("classifies unavailable NATS request errors wrapped by RequestError", () => {
    expect(
      remoteGatewayUnavailableReason(
        new RequestError("request failed", {
          cause: new NoRespondersError("test.subject"),
        }),
      ),
    ).toBe("no_responders");
    expect(
      remoteGatewayUnavailableReason(
        new RequestError("request failed", {
          cause: new ClosedConnectionError(),
        }),
      ),
    ).toBe("connection_closed");
    expect(
      remoteGatewayUnavailableReason(
        new RequestError("request failed", {
          cause: new DrainingConnectionError(),
        }),
      ),
    ).toBe("connection_draining");
  });

  it("maps unavailable gateway forwarding to Port Access bootstrap-not-connected", () => {
    const portAccessError = toPortAccessForwardingRequestError(
      new GatewayForwardingUnavailableError("Remote gateway forwarding is unavailable.", {
        operation: "authorizePortAccessTarget",
        reason: "no_responders",
        sandboxInstanceId: "sbi_test",
        subject: "mistle-test.gateway.forward.dpg_missing",
        target: gatewayForwardingTarget(),
      }),
      {
        sandboxInstanceId: "sbi_test",
        target: {
          kind: "port",
          port: 5173,
        },
      },
    );

    expect(portAccessError).toMatchObject({
      code: GatewayForwardingPortAccessAuthorizationErrorCodes.BOOTSTRAP_NOT_CONNECTED,
      message: "Remote gateway forwarding is unavailable for sandbox 'sbi_test' port 5173.",
    });
  });
});

function gatewayForwardingTarget(): GatewayForwardingTarget {
  return {
    sourceNodeId: "dpg_source",
    targetBootstrapSessionId: "sess_missing",
    targetNodeId: "dpg_missing",
  };
}
