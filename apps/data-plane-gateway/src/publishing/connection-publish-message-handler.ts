import {
  type PublishListenersGet,
  type PublishListenersSnapshot,
  type PublishTargetAuthorizeResult,
  type PublishControlMessage,
} from "@mistle/sandbox-session-protocol";

import { TunnelProtocolViolationError } from "../tunnel/protocol/tunnel-protocol-translator.js";
import type { TunnelProtocolTranslation } from "../tunnel/protocol/tunnel-protocol-translator.js";
import type { TunnelSessionRegistry } from "../tunnel/tunnel-session/index.js";
import type { RelayPeerSide } from "../tunnel/types.js";
import type { BootstrapPublishControlRequestCoordinator } from "./bootstrap-publish-control-request-coordinator.js";
import {
  ConnectionPublishRequestCoordinator,
  DuplicateConnectionPublishRequestIdError,
} from "./connection-publish-request-coordinator.js";

function createTranslation(
  input: TunnelProtocolTranslation["delivery"],
): TunnelProtocolTranslation {
  return {
    delivery: input,
  };
}

function stringifyPublishControlMessage(message: PublishControlMessage): string {
  return JSON.stringify(message);
}

function replaceRequestId<TMessage extends PublishListenersGet | PublishListenersSnapshot>(input: {
  message: TMessage;
  requestId: string;
}): TMessage {
  return {
    ...input.message,
    requestId: input.requestId,
  };
}

export class ConnectionPublishMessageHandler {
  public constructor(
    private readonly tunnelSessionRegistry: TunnelSessionRegistry,
    private readonly requestCoordinator: ConnectionPublishRequestCoordinator,
    private readonly bootstrapPublishControlRequestCoordinator: BootstrapPublishControlRequestCoordinator,
  ) {}

  public handleControlMessage(input: {
    clientSessionId: string;
    controlMessage: PublishControlMessage;
    sandboxInstanceId: string;
    sourcePeerSide: RelayPeerSide;
  }): TunnelProtocolTranslation {
    if (input.sourcePeerSide === "connection") {
      return this.#handleConnectionMessage({
        clientSessionId: input.clientSessionId,
        controlMessage: input.controlMessage,
        sandboxInstanceId: input.sandboxInstanceId,
      });
    }

    return this.#handleBootstrapMessage({
      controlMessage: input.controlMessage,
    });
  }

  public releaseClientSession(input: { clientSessionId: string }): void {
    this.requestCoordinator.releaseClientSession(input);
  }

  public releaseBootstrapPeer(input: { sandboxInstanceId: string }): void {
    this.bootstrapPublishControlRequestCoordinator.rejectSandboxInstanceRequests(input);
  }

  #handleConnectionMessage(input: {
    clientSessionId: string;
    controlMessage: PublishControlMessage;
    sandboxInstanceId: string;
  }): TunnelProtocolTranslation {
    if (input.controlMessage.type !== "publish.listeners.get") {
      throw new TunnelProtocolViolationError(
        `Connection websocket cannot send publish control message type '${input.controlMessage.type}'.`,
      );
    }

    const bootstrapTarget = this.tunnelSessionRegistry.getBootstrapTarget({
      sandboxInstanceId: input.sandboxInstanceId,
    });
    if (bootstrapTarget === undefined) {
      throw new TunnelProtocolViolationError(
        "Sandbox bootstrap tunnel is not connected for publish.listeners.get.",
      );
    }

    let bootstrapRequestId: string;
    try {
      bootstrapRequestId = this.requestCoordinator.beginRequest({
        clientRequestId: input.controlMessage.requestId,
        clientSessionId: input.clientSessionId,
      }).bootstrapRequestId;
    } catch (error) {
      if (error instanceof DuplicateConnectionPublishRequestIdError) {
        throw new TunnelProtocolViolationError(error.message);
      }

      throw error;
    }

    return createTranslation({
      kind: "forward",
      payload: stringifyPublishControlMessage(
        replaceRequestId({
          message: input.controlMessage,
          requestId: bootstrapRequestId,
        }),
      ),
    });
  }

  #handleBootstrapMessage(input: {
    controlMessage: PublishControlMessage;
  }): TunnelProtocolTranslation | undefined {
    if (input.controlMessage.type === "publish.target.authorize.result") {
      return this.#handleAuthorizeResult({
        controlMessage: input.controlMessage,
      });
    }

    if (input.controlMessage.type !== "publish.listeners.snapshot") {
      return undefined;
    }

    const resolvedRequest = this.requestCoordinator.resolveRequest({
      bootstrapRequestId: input.controlMessage.requestId,
    });
    if (resolvedRequest === undefined) {
      return createTranslation({
        kind: "drop",
      });
    }

    return createTranslation({
      kind: "forward",
      payload: stringifyPublishControlMessage(
        replaceRequestId({
          message: input.controlMessage,
          requestId: resolvedRequest.clientRequestId,
        }),
      ),
      targetConnectionSessionId: resolvedRequest.clientSessionId,
    });
  }

  #handleAuthorizeResult(input: {
    controlMessage: PublishTargetAuthorizeResult;
  }): TunnelProtocolTranslation {
    this.bootstrapPublishControlRequestCoordinator.resolveAuthorizeRequest({
      requestId: input.controlMessage.requestId,
      authorized: input.controlMessage.authorized,
      ...(input.controlMessage.reason === undefined
        ? {}
        : {
            reason: input.controlMessage.reason,
          }),
    });

    return createTranslation({
      kind: "drop",
    });
  }
}
