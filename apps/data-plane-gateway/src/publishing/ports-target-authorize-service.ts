import { randomUUID } from "node:crypto";

import {
  type PortAccessTarget,
  type PortsTargetAuthorize,
  type PortsTargetAuthorizeResult,
} from "@mistle/sandbox-session-protocol";
import type { Scheduler, TimerHandle } from "@mistle/time";

import { BootstrapTunnelNotConnectedError } from "../tunnel/bootstrap-tunnel-not-connected-error.js";
import type { TunnelRelayCoordinator } from "../tunnel/relay-coordinator.js";

const PortsTargetAuthorizeTimeoutMs = 5_000;

type PendingPortsTargetAuthorizeRequest = {
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
    }
);

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
      "forwardPeerMessage" | "getBootstrapPeer"
    >,
    private readonly scheduler: Scheduler,
  ) {}

  public async requestTargetAuthorize(input: {
    sandboxInstanceId: string;
    target: PortAccessTarget;
  }): Promise<PortsTargetAuthorizeResult> {
    if (
      this.relayCoordinator.getBootstrapPeer({
        sandboxInstanceId: input.sandboxInstanceId,
      }) === undefined
    ) {
      throw new BootstrapTunnelNotConnectedError(input.sandboxInstanceId);
    }

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
          timeoutHandle,
        },
      });
    });

    try {
      await this.relayCoordinator.forwardPeerMessage({
        sandboxInstanceId: input.sandboxInstanceId,
        fromSide: "connection",
        payload,
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
    const timeoutHandle = this.scheduler.schedule(() => {
      this.deletePendingRequest({
        sandboxInstanceId: input.sandboxInstanceId,
        requestId: input.request.requestId,
      });
    }, PortsTargetAuthorizeTimeoutMs);

    this.setPendingRequest({
      sandboxInstanceId: input.sandboxInstanceId,
      requestId: input.request.requestId,
      pendingRequest: {
        kind: "connection",
        clientSessionId: input.clientSessionId,
        timeoutHandle,
      },
    });

    try {
      await this.relayCoordinator.forwardPeerMessage({
        sandboxInstanceId: input.sandboxInstanceId,
        fromSide: "connection",
        payload: JSON.stringify(input.request),
      });
    } catch (error) {
      this.deletePendingRequest({
        sandboxInstanceId: input.sandboxInstanceId,
        requestId: input.request.requestId,
      });
      throw error;
    }
  }

  public resolveTargetAuthorizeResult(input: {
    sandboxInstanceId: string;
    result: PortsTargetAuthorizeResult;
  }):
    | {
        kind: "drop";
      }
    | {
        kind: "forward";
        targetConnectionSessionId: string;
      }
    | undefined {
    const pendingRequest = this.getPendingRequest({
      sandboxInstanceId: input.sandboxInstanceId,
      requestId: input.result.requestId,
    });
    if (pendingRequest === undefined) {
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
      targetConnectionSessionId: pendingRequest.clientSessionId,
    };
  }

  public rejectPendingRequestsForSandbox(input: { sandboxInstanceId: string }): void {
    const pendingRequests = this.#pendingRequestsBySandboxInstanceId.get(input.sandboxInstanceId);
    if (pendingRequests === undefined) {
      return;
    }

    this.#pendingRequestsBySandboxInstanceId.delete(input.sandboxInstanceId);
    for (const pendingRequest of pendingRequests.values()) {
      this.scheduler.cancel(pendingRequest.timeoutHandle);
      if (pendingRequest.kind === "internal") {
        pendingRequest.reject(
          new PortsTargetAuthorizeBootstrapDisconnectedError(input.sandboxInstanceId),
        );
      }
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
}
