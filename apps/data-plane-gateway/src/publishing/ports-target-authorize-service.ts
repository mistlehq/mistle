import type { PortsTargetAuthorizeResult } from "@mistle/sandbox-session-protocol";
import type { Scheduler, TimerHandle } from "@mistle/time";
import { typeid } from "typeid-js";

import type { TunnelRelayCoordinator } from "../tunnel/relay-coordinator.js";

const DefaultAuthorizeTimeoutMs = 5_000;

export const PortsTargetAuthorizeErrorCode = {
  AUTHORIZE_TIMEOUT: "AUTHORIZE_TIMEOUT",
  BOOTSTRAP_NOT_CONNECTED: "BOOTSTRAP_NOT_CONNECTED",
} as const;

export type PortsTargetAuthorizeErrorCode =
  (typeof PortsTargetAuthorizeErrorCode)[keyof typeof PortsTargetAuthorizeErrorCode];

export class PortsTargetAuthorizeError extends Error {
  readonly code: PortsTargetAuthorizeErrorCode;

  public constructor(input: { code: PortsTargetAuthorizeErrorCode; message: string }) {
    super(input.message);
    this.name = "PortsTargetAuthorizeError";
    this.code = input.code;
  }
}

type PendingRequest = {
  resolve: (result: PortsTargetAuthorizeResult) => void;
  reject: (error: PortsTargetAuthorizeError) => void;
  timeoutHandle: TimerHandle;
};

export class PortsTargetAuthorizeService {
  private readonly pendingRequestsById = new Map<string, PendingRequest>();

  public constructor(
    private readonly relayCoordinator: TunnelRelayCoordinator,
    private readonly scheduler: Scheduler,
    private readonly timeoutMs: number = DefaultAuthorizeTimeoutMs,
  ) {}

  public async authorizePort(input: {
    sandboxInstanceId: string;
    port: number;
  }): Promise<PortsTargetAuthorizeResult> {
    const bootstrapPeer = this.relayCoordinator.getBootstrapPeer({
      sandboxInstanceId: input.sandboxInstanceId,
    });
    if (bootstrapPeer === undefined) {
      throw new PortsTargetAuthorizeError({
        code: PortsTargetAuthorizeErrorCode.BOOTSTRAP_NOT_CONNECTED,
        message: `Sandbox '${input.sandboxInstanceId}' does not have an attached bootstrap tunnel.`,
      });
    }

    const requestId = typeid("pta").toString();
    const resultPromise = new Promise<PortsTargetAuthorizeResult>((resolve, reject) => {
      const timeoutHandle = this.scheduler.schedule(() => {
        this.pendingRequestsById.delete(requestId);
        reject(
          new PortsTargetAuthorizeError({
            code: PortsTargetAuthorizeErrorCode.AUTHORIZE_TIMEOUT,
            message: `Timed out waiting for port ${String(input.port)} authorization from sandbox '${input.sandboxInstanceId}'.`,
          }),
        );
      }, this.timeoutMs);

      this.pendingRequestsById.set(requestId, {
        resolve,
        reject,
        timeoutHandle,
      });
    });

    try {
      await this.relayCoordinator.forwardPeerMessage({
        sandboxInstanceId: input.sandboxInstanceId,
        fromSide: "connection",
        payload: JSON.stringify({
          type: "ports.target.authorize",
          requestId,
          target: {
            kind: "port",
            port: input.port,
          },
        }),
      });
      return await resultPromise;
    } catch (error) {
      this.rejectAndDeletePendingRequest(requestId, error);
      throw error;
    }
  }

  public handleAuthorizeResult(message: PortsTargetAuthorizeResult): boolean {
    const pendingRequest = this.pendingRequestsById.get(message.requestId);
    if (pendingRequest === undefined) {
      return false;
    }

    this.scheduler.cancel(pendingRequest.timeoutHandle);
    this.pendingRequestsById.delete(message.requestId);
    pendingRequest.resolve(message);
    return true;
  }

  private rejectAndDeletePendingRequest(requestId: string, error: unknown): void {
    const pendingRequest = this.pendingRequestsById.get(requestId);
    if (pendingRequest === undefined) {
      return;
    }

    this.scheduler.cancel(pendingRequest.timeoutHandle);
    this.pendingRequestsById.delete(requestId);
    if (error instanceof PortsTargetAuthorizeError) {
      pendingRequest.reject(error);
      return;
    }

    pendingRequest.reject(
      new PortsTargetAuthorizeError({
        code: PortsTargetAuthorizeErrorCode.AUTHORIZE_TIMEOUT,
        message: "Port authorization failed unexpectedly.",
      }),
    );
  }
}
