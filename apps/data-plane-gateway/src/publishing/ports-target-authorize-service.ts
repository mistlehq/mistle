import { randomUUID } from "node:crypto";

import {
  type PortsTargetAuthorize,
  type PortsTargetAuthorizeFailureResult,
  type PortAccessTarget,
  type PortsTargetAuthorizeResult,
} from "@mistle/sandbox-session-protocol";
import type { Scheduler, TimerHandle } from "@mistle/time";

import { BootstrapTunnelNotConnectedError } from "../tunnel/bootstrap-tunnel-not-connected-error.js";
import type { GatewayForwardingClientAdapter } from "../tunnel/gateway-forwarding/gateway-forwarding-client-adapter.js";
import type { GatewayForwardingTarget } from "../tunnel/gateway-forwarding/types.js";
import type { TunnelRelayCoordinator } from "../tunnel/relay-coordinator.js";
import type { RelayTarget } from "../tunnel/types.js";

const PortsTargetAuthorizeTimeoutMs = 5_000;

type PendingPortsTargetAuthorizeRequest = {
  targetBootstrapSessionId: string;
  timeoutHandle: TimerHandle;
} & (
  | {
      kind: "internal";
      resolve: (result: PortsTargetAuthorizeResult) => void;
      reject: (error: Error) => void;
    }
  | {
      kind: "connection";
      clientSessionId: string;
      originalRequestId: string;
    }
);

type PendingConnectionTargetAuthorizeResolution = {
  kind: "forward";
  result: PortsTargetAuthorizeResult;
  targetConnectionSessionId: string;
};

type RejectedPendingConnectionTargetAuthorizeRequest = {
  result: PortsTargetAuthorizeFailureResult;
  targetConnectionSessionId: string;
};

export class PortsTargetAuthorizeTimedOutError extends Error {
  public constructor(sandboxInstanceId: string, port: number) {
    super(
      `Timed out waiting for port access authorization for sandbox '${sandboxInstanceId}' port ${String(port)}.`,
    );
  }
}

export class PortsTargetAuthorizeBootstrapDisconnectedError extends Error {
  public constructor(sandboxInstanceId: string) {
    super(
      `Sandbox bootstrap tunnel disconnected before port access authorization completed for sandbox '${sandboxInstanceId}'.`,
    );
  }
}

export class PortsTargetAuthorizeService {
  readonly #pendingRequestsBySandboxInstanceId = new Map<
    string,
    Map<string, PendingPortsTargetAuthorizeRequest>
  >();

  public constructor(
    private readonly relayCoordinator: Pick<
      TunnelRelayCoordinator,
      "forwardPeerMessage" | "getBootstrapPeer" | "resolveBootstrapPeer"
    >,
    private readonly scheduler: Scheduler,
    private readonly remoteGatewayForwarding?: {
      client: GatewayForwardingClientAdapter;
      localNodeId: string;
    },
  ) {}

  public async requestTargetAuthorize(input: {
    sandboxInstanceId: string;
    target: PortAccessTarget;
  }): Promise<PortsTargetAuthorizeResult> {
    const bootstrapTarget = await this.resolveBootstrapTarget({
      sandboxInstanceId: input.sandboxInstanceId,
    });
    if (
      this.remoteGatewayForwarding !== undefined &&
      bootstrapTarget.nodeId !== this.remoteGatewayForwarding.localNodeId
    ) {
      return this.remoteGatewayForwarding.client.authorizePortAccessTarget(
        toGatewayForwardingTarget({
          localNodeId: this.remoteGatewayForwarding.localNodeId,
          target: bootstrapTarget,
        }),
        input,
      );
    }

    return this.requestLocalTargetAuthorize({
      ...input,
      targetBootstrapSessionId: bootstrapTarget.sessionId,
    });
  }

  public async requestLocalTargetAuthorize(input: {
    sandboxInstanceId: string;
    target: PortAccessTarget;
    targetBootstrapSessionId: string;
  }): Promise<PortsTargetAuthorizeResult> {
    const bootstrapTarget = this.requireLocalBootstrapTarget({
      sandboxInstanceId: input.sandboxInstanceId,
      targetBootstrapSessionId: input.targetBootstrapSessionId,
    });
    const requestId = randomUUID();
    const payload = JSON.stringify({
      type: "ports.target.authorize",
      requestId,
      target: input.target,
    } satisfies PortsTargetAuthorize);

    const pendingPromise = new Promise<PortsTargetAuthorizeResult>((resolve, reject) => {
      const timeoutHandle = this.scheduler.schedule(() => {
        this.deletePendingRequest({
          sandboxInstanceId: input.sandboxInstanceId,
          requestId,
        });
        reject(new PortsTargetAuthorizeTimedOutError(input.sandboxInstanceId, input.target.port));
      }, PortsTargetAuthorizeTimeoutMs);

      this.setPendingRequest({
        sandboxInstanceId: input.sandboxInstanceId,
        requestId,
        pendingRequest: {
          kind: "internal",
          resolve,
          reject,
          targetBootstrapSessionId: bootstrapTarget.sessionId,
          timeoutHandle,
        },
      });
    });

    try {
      await this.relayCoordinator.forwardPeerMessage({
        sandboxInstanceId: input.sandboxInstanceId,
        fromSide: "connection",
        payload,
        targetSessionId: bootstrapTarget.sessionId,
      });
    } catch (error) {
      this.rejectPendingRequest({
        sandboxInstanceId: input.sandboxInstanceId,
        requestId,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      throw error;
    }

    return pendingPromise;
  }

  public async forwardConnectionTargetAuthorize(input: {
    sandboxInstanceId: string;
    clientSessionId: string;
    request: PortsTargetAuthorize;
  }): Promise<void> {
    const bootstrapTarget = this.requireLocalBootstrapTarget({
      sandboxInstanceId: input.sandboxInstanceId,
    });
    const forwardedRequestId = randomUUID();
    const timeoutHandle = this.scheduler.schedule(() => {
      this.deletePendingRequest({
        sandboxInstanceId: input.sandboxInstanceId,
        requestId: forwardedRequestId,
      });
    }, PortsTargetAuthorizeTimeoutMs);

    this.setPendingRequest({
      sandboxInstanceId: input.sandboxInstanceId,
      requestId: forwardedRequestId,
      pendingRequest: {
        kind: "connection",
        clientSessionId: input.clientSessionId,
        originalRequestId: input.request.requestId,
        targetBootstrapSessionId: bootstrapTarget.sessionId,
        timeoutHandle,
      },
    });

    try {
      await this.relayCoordinator.forwardPeerMessage({
        sandboxInstanceId: input.sandboxInstanceId,
        fromSide: "connection",
        payload: JSON.stringify({
          ...input.request,
          requestId: forwardedRequestId,
        } satisfies PortsTargetAuthorize),
        targetSessionId: bootstrapTarget.sessionId,
      });
    } catch (error) {
      this.deletePendingRequest({
        sandboxInstanceId: input.sandboxInstanceId,
        requestId: forwardedRequestId,
      });
      throw error;
    }
  }

  public resolveTargetAuthorizeResult(input: {
    sandboxInstanceId: string;
    sourceBootstrapSessionId: string;
    result: PortsTargetAuthorizeResult;
  }):
    | {
        kind: "drop";
      }
    | PendingConnectionTargetAuthorizeResolution
    | undefined {
    const pendingRequest = this.getPendingRequest({
      sandboxInstanceId: input.sandboxInstanceId,
      requestId: input.result.requestId,
    });
    if (pendingRequest === undefined) {
      return undefined;
    }
    if (
      pendingRequest.targetBootstrapSessionId !== input.sourceBootstrapSessionId ||
      !this.isCurrentBootstrapSession(input)
    ) {
      return undefined;
    }

    this.scheduler.cancel(pendingRequest.timeoutHandle);
    this.deletePendingRequest({
      sandboxInstanceId: input.sandboxInstanceId,
      requestId: input.result.requestId,
    });

    if (pendingRequest.kind === "internal") {
      pendingRequest.resolve(input.result);
      return {
        kind: "drop",
      };
    }

    return {
      kind: "forward",
      result: {
        ...input.result,
        requestId: pendingRequest.originalRequestId,
      },
      targetConnectionSessionId: pendingRequest.clientSessionId,
    };
  }

  public rejectPendingRequestsForBootstrapSession(input: {
    sandboxInstanceId: string;
    targetBootstrapSessionId: string;
  }): RejectedPendingConnectionTargetAuthorizeRequest[] {
    const pendingRequests = this.#pendingRequestsBySandboxInstanceId.get(input.sandboxInstanceId);
    if (pendingRequests === undefined) {
      return [];
    }

    const rejectedConnectionRequests: RejectedPendingConnectionTargetAuthorizeRequest[] = [];
    for (const [requestId, pendingRequest] of pendingRequests) {
      if (pendingRequest.targetBootstrapSessionId !== input.targetBootstrapSessionId) {
        continue;
      }

      this.scheduler.cancel(pendingRequest.timeoutHandle);
      pendingRequests.delete(requestId);
      if (pendingRequest.kind === "internal") {
        pendingRequest.reject(
          new PortsTargetAuthorizeBootstrapDisconnectedError(input.sandboxInstanceId),
        );
        continue;
      }

      rejectedConnectionRequests.push({
        result: {
          type: "ports.target.authorize.result",
          requestId: pendingRequest.originalRequestId,
          authorized: false,
          reason: "bootstrap_disconnected",
        },
        targetConnectionSessionId: pendingRequest.clientSessionId,
      });
    }
    if (pendingRequests.size === 0) {
      this.#pendingRequestsBySandboxInstanceId.delete(input.sandboxInstanceId);
    }

    return rejectedConnectionRequests;
  }

  public rejectPendingRequestsForConnection(input: {
    clientSessionId: string;
    sandboxInstanceId: string;
  }): void {
    const pendingRequests = this.#pendingRequestsBySandboxInstanceId.get(input.sandboxInstanceId);
    if (pendingRequests === undefined) {
      return;
    }

    for (const [requestId, pendingRequest] of pendingRequests) {
      if (
        pendingRequest.kind !== "connection" ||
        pendingRequest.clientSessionId !== input.clientSessionId
      ) {
        continue;
      }

      this.scheduler.cancel(pendingRequest.timeoutHandle);
      pendingRequests.delete(requestId);
    }

    if (pendingRequests.size === 0) {
      this.#pendingRequestsBySandboxInstanceId.delete(input.sandboxInstanceId);
    }
  }

  private setPendingRequest(input: {
    sandboxInstanceId: string;
    requestId: string;
    pendingRequest: PendingPortsTargetAuthorizeRequest;
  }): void {
    const pendingRequests =
      this.#pendingRequestsBySandboxInstanceId.get(input.sandboxInstanceId) ?? new Map();
    pendingRequests.set(input.requestId, input.pendingRequest);
    this.#pendingRequestsBySandboxInstanceId.set(input.sandboxInstanceId, pendingRequests);
  }

  private getPendingRequest(input: {
    sandboxInstanceId: string;
    requestId: string;
  }): PendingPortsTargetAuthorizeRequest | undefined {
    return this.#pendingRequestsBySandboxInstanceId
      .get(input.sandboxInstanceId)
      ?.get(input.requestId);
  }

  private deletePendingRequest(input: { sandboxInstanceId: string; requestId: string }): void {
    const pendingRequests = this.#pendingRequestsBySandboxInstanceId.get(input.sandboxInstanceId);
    if (pendingRequests === undefined) {
      return;
    }

    pendingRequests.delete(input.requestId);
    if (pendingRequests.size === 0) {
      this.#pendingRequestsBySandboxInstanceId.delete(input.sandboxInstanceId);
    }
  }

  private rejectPendingRequest(input: {
    sandboxInstanceId: string;
    requestId: string;
    error: Error;
  }): void {
    const pendingRequest = this.getPendingRequest({
      sandboxInstanceId: input.sandboxInstanceId,
      requestId: input.requestId,
    });
    if (pendingRequest === undefined) {
      return;
    }

    this.scheduler.cancel(pendingRequest.timeoutHandle);
    this.deletePendingRequest({
      sandboxInstanceId: input.sandboxInstanceId,
      requestId: input.requestId,
    });
    if (pendingRequest.kind === "internal") {
      pendingRequest.reject(input.error);
    }
  }

  private async resolveBootstrapTarget(input: { sandboxInstanceId: string }): Promise<RelayTarget> {
    const bootstrapTarget = await this.relayCoordinator.resolveBootstrapPeer({
      sandboxInstanceId: input.sandboxInstanceId,
    });
    if (bootstrapTarget === undefined) {
      throw new BootstrapTunnelNotConnectedError(input.sandboxInstanceId);
    }

    return bootstrapTarget;
  }

  private requireLocalBootstrapTarget(input: {
    sandboxInstanceId: string;
    targetBootstrapSessionId?: string;
  }): RelayTarget {
    const bootstrapTarget = this.relayCoordinator.getBootstrapPeer({
      sandboxInstanceId: input.sandboxInstanceId,
    });
    if (bootstrapTarget === undefined) {
      throw new BootstrapTunnelNotConnectedError(input.sandboxInstanceId);
    }
    if (
      input.targetBootstrapSessionId !== undefined &&
      bootstrapTarget.sessionId !== input.targetBootstrapSessionId
    ) {
      throw new Error(
        `Resolved bootstrap session is no longer current for sandbox '${input.sandboxInstanceId}'.`,
      );
    }

    return bootstrapTarget;
  }

  private isCurrentBootstrapSession(input: {
    sandboxInstanceId: string;
    sourceBootstrapSessionId: string;
  }): boolean {
    return (
      this.relayCoordinator.getBootstrapPeer({
        sandboxInstanceId: input.sandboxInstanceId,
      })?.sessionId === input.sourceBootstrapSessionId
    );
  }
}

function toGatewayForwardingTarget(input: {
  localNodeId: string;
  target: RelayTarget;
}): GatewayForwardingTarget {
  return {
    sourceNodeId: input.localNodeId,
    targetNodeId: input.target.nodeId,
    targetBootstrapSessionId: input.target.sessionId,
  };
}
