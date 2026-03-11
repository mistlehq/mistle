import type { WSEvents } from "hono/ws";
import type { WebSocket } from "ws";

import type { GatewayWebSocketForwardRequest, GatewayWebSocketForwarder } from "../types.js";

const CloseCodeForwardingNotEnabled = 1013;

type RejectingGatewayWebSocketForwarderInput = {
  reason: string;
};

export class RejectingGatewayWebSocketForwarder implements GatewayWebSocketForwarder {
  public constructor(private readonly reason: string) {}

  public static create(
    input: RejectingGatewayWebSocketForwarderInput,
  ): RejectingGatewayWebSocketForwarder {
    return new RejectingGatewayWebSocketForwarder(input.reason);
  }

  public createEvents(_input: GatewayWebSocketForwardRequest): WSEvents<WebSocket> {
    return {
      onOpen: (_event, ws) => {
        ws.close(CloseCodeForwardingNotEnabled, this.reason);
      },
    };
  }
}
