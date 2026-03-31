import type { TunnelProtocolTranslation } from "../tunnel/protocol/tunnel-protocol-translator.js";
import type { RelayPayload, RelayPeerSide } from "../tunnel/types.js";
import { ConnectionPublishMessageHandler } from "./connection-publish-message-handler.js";

export class TunnelMessageDispatcher {
  public constructor(
    private readonly connectionPublishMessageHandler: ConnectionPublishMessageHandler,
  ) {}

  public handleInboundMessage(input: {
    clientSessionId: string;
    payload: RelayPayload;
    sandboxInstanceId: string;
    sourcePeerSide: RelayPeerSide;
  }): TunnelProtocolTranslation | undefined {
    if (typeof input.payload !== "string") {
      return undefined;
    }

    return this.connectionPublishMessageHandler.handleTextMessage({
      clientSessionId: input.clientSessionId,
      payload: input.payload,
      sandboxInstanceId: input.sandboxInstanceId,
      sourcePeerSide: input.sourcePeerSide,
    });
  }

  public releaseClientSession(input: { clientSessionId: string }): void {
    this.connectionPublishMessageHandler.releaseClientSession(input);
  }
}
