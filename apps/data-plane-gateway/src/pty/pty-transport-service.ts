import { randomUUID } from "node:crypto";

import {
  PtyTransportTokenError,
  PtyTransportTokenRoles,
  mintPtyTransportToken,
  verifyPtyTransportToken,
  type PtyTransportTokenConfig,
  type VerifiedPtyTransportToken,
} from "@mistle/gateway-tunnel-auth";
import {
  parsePtyTransportClientOpen,
  type PtySessionLaunch,
  type PtySessionOpen,
} from "@mistle/sandbox-session-protocol";
import type { WSContext, WSMessageReceive } from "hono/ws";
import WebSocket from "ws";

import { BootstrapTunnelNotConnectedError } from "../tunnel/bootstrap-tunnel-not-connected-error.js";
import type { SandboxOwnerResolver } from "../tunnel/ownership/sandbox-owner-resolver.js";
import type { TunnelRelayCoordinator } from "../tunnel/relay-coordinator.js";
import type { RelayPayload, RelayTarget } from "../tunnel/types.js";
import type { DataPlaneGatewayConfig } from "../types.js";

export const PtyTransportWebSocketRoutePath = "/_mistle/pty/connect";
export const PtyTransportTokenQueryParam = "pty_token";

const SandboxTransportTokenTtlSeconds = 120;
const WebSocketCloseCodes = {
  POLICY_VIOLATION: 1008,
  INTERNAL_ERROR: 1011,
};

type PtyTransportSide = "client" | "sandbox";

export type PtyTransportAdmission = {
  claims: VerifiedPtyTransportToken;
  side: PtyTransportSide;
};

type PtyTransportSession = {
  client: WSContext<WebSocket>;
  clientTarget: RelayTarget;
  clientOpenRequested: boolean;
  pendingClientMessages: WSMessageReceive[];
};

export class PtyTransportError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "PtyTransportError";
  }
}

export class PtyTransportService {
  private readonly sessions = new Map<string, PtyTransportSession>();
  private readonly sandboxTargets = new Map<string, RelayTarget>();

  public constructor(
    private readonly input: {
      config: DataPlaneGatewayConfig["sandbox"];
      relayCoordinator: TunnelRelayCoordinator;
      sandboxOwnerResolver: SandboxOwnerResolver;
      tokenConfig: PtyTransportTokenConfig;
    },
  ) {}

  public async authorize(input: { token: string | null }): Promise<PtyTransportAdmission> {
    if (input.token === null || input.token.length === 0) {
      throw new PtyTransportError("PTY transport token is required.", 401);
    }

    try {
      const claims = await verifyPtyTransportToken({
        config: this.input.tokenConfig,
        token: input.token,
      });

      return {
        claims,
        side: claims.role === PtyTransportTokenRoles.CLIENT ? "client" : "sandbox",
      };
    } catch (error) {
      if (error instanceof PtyTransportTokenError) {
        throw new PtyTransportError(error.message, 401);
      }

      throw error;
    }
  }

  public async canAttach(input: { admission: PtyTransportAdmission }): Promise<boolean> {
    if (input.admission.side === "client") {
      const existingClient = await this.input.relayCoordinator.resolveSessionPeer({
        sandboxInstanceId: input.admission.claims.sub,
        side: "ptyClient",
        sessionId: input.admission.claims.ptySessionId,
      });
      return existingClient === undefined;
    }

    const existingSandbox = await this.input.relayCoordinator.resolveSessionPeer({
      sandboxInstanceId: input.admission.claims.sub,
      side: "ptySandbox",
      sessionId: input.admission.claims.ptySessionId,
    });
    return existingSandbox === undefined;
  }

  public attachClient(input: {
    admission: PtyTransportAdmission;
    socket: WSContext<WebSocket>;
  }): void {
    const key = createSessionKey(input.admission.claims);
    if (this.sessions.has(key)) {
      input.socket.close(WebSocketCloseCodes.POLICY_VIOLATION, "PTY transport session exists.");
      return;
    }

    const clientTarget = this.input.relayCoordinator.attachPeer({
      sandboxInstanceId: input.admission.claims.sub,
      side: "ptyClient",
      socket: input.socket,
      sessionId: input.admission.claims.ptySessionId,
    });

    this.sessions.set(key, {
      client: input.socket,
      clientTarget,
      clientOpenRequested: false,
      pendingClientMessages: [],
    });
  }

  public attachSandbox(input: {
    admission: PtyTransportAdmission;
    socket: WSContext<WebSocket>;
  }): void {
    const key = createSessionKey(input.admission.claims);
    const sandboxTarget = this.input.relayCoordinator.attachPeer({
      sandboxInstanceId: input.admission.claims.sub,
      side: "ptySandbox",
      socket: input.socket,
      sessionId: input.admission.claims.ptySessionId,
    });
    this.sandboxTargets.set(key, sandboxTarget);

    const session = this.sessions.get(key);
    if (session === undefined) {
      return;
    }
    for (const message of session.pendingClientMessages.splice(0)) {
      sendWebSocketMessage({
        message,
        receiver: input.socket,
      });
    }
  }

  public async handleClientMessage(input: {
    admission: PtyTransportAdmission;
    message: WSMessageReceive;
    socket: WSContext<WebSocket>;
    testEnvironmentId: string | undefined;
    testEnvironmentIdQueryParam: string | undefined;
  }): Promise<void> {
    const key = createSessionKey(input.admission.claims);
    const session = this.sessions.get(key);
    if (session === undefined) {
      input.socket.close(WebSocketCloseCodes.POLICY_VIOLATION, "PTY transport session is missing.");
      return;
    }

    if (!session.clientOpenRequested) {
      await this.requestSandboxTransport({
        admission: input.admission,
        message: input.message,
        session,
        testEnvironmentId: input.testEnvironmentId,
        testEnvironmentIdQueryParam: input.testEnvironmentIdQueryParam,
      });
      return;
    }

    const sandboxTarget = await this.input.relayCoordinator.resolveSessionPeer({
      sandboxInstanceId: input.admission.claims.sub,
      side: "ptySandbox",
      sessionId: input.admission.claims.ptySessionId,
    });
    if (sandboxTarget === undefined) {
      session.pendingClientMessages.push(input.message);
      return;
    }

    await this.input.relayCoordinator.forwardSessionPeerMessage({
      sandboxInstanceId: input.admission.claims.sub,
      targetSide: "ptySandbox",
      targetSessionId: input.admission.claims.ptySessionId,
      payload: await toRelayPayload(input.message),
    });
  }

  public async handleSandboxMessage(input: {
    admission: PtyTransportAdmission;
    message: WSMessageReceive;
    socket: WSContext<WebSocket>;
  }): Promise<void> {
    const clientTarget = await this.input.relayCoordinator.resolveSessionPeer({
      sandboxInstanceId: input.admission.claims.sub,
      side: "ptyClient",
      sessionId: input.admission.claims.ptySessionId,
    });
    if (clientTarget === undefined) {
      input.socket.close(WebSocketCloseCodes.POLICY_VIOLATION, "PTY transport session is missing.");
      return;
    }

    await this.input.relayCoordinator.forwardSessionPeerMessage({
      sandboxInstanceId: input.admission.claims.sub,
      targetSide: "ptyClient",
      targetSessionId: input.admission.claims.ptySessionId,
      payload: await toRelayPayload(input.message),
    });
  }

  public detach(input: {
    admission: PtyTransportAdmission;
    closeCode: number;
    closeReason: string;
  }): void {
    const key = createSessionKey(input.admission.claims);
    if (input.admission.side === "client") {
      const session = this.sessions.get(key);
      if (session !== undefined) {
        this.sessions.delete(key);
        this.input.relayCoordinator.detachPeer(session.clientTarget);
      }
      this.closePeer({
        sandboxInstanceId: input.admission.claims.sub,
        targetSide: "ptySandbox",
        targetSessionId: input.admission.claims.ptySessionId,
        closeCode: normalizeForwardedCloseCode(input.closeCode),
        closeReason: input.closeReason,
      });
      return;
    }

    const sandboxTarget = this.sandboxTargets.get(key);
    if (sandboxTarget !== undefined) {
      this.sandboxTargets.delete(key);
      this.input.relayCoordinator.detachPeer(sandboxTarget);
    }
    this.closePeer({
      sandboxInstanceId: input.admission.claims.sub,
      targetSide: "ptyClient",
      targetSessionId: input.admission.claims.ptySessionId,
      closeCode: normalizeForwardedCloseCode(input.closeCode),
      closeReason: input.closeReason,
    });
  }

  private async requestSandboxTransport(input: {
    admission: PtyTransportAdmission;
    message: WSMessageReceive;
    session: PtyTransportSession;
    testEnvironmentId: string | undefined;
    testEnvironmentIdQueryParam: string | undefined;
  }): Promise<void> {
    if (typeof input.message !== "string") {
      input.session.client.close(
        WebSocketCloseCodes.POLICY_VIOLATION,
        "PTY transport open message must be text.",
      );
      return;
    }

    const open = parsePtyTransportClientOpen(input.message);
    if (open === undefined) {
      input.session.client.close(
        WebSocketCloseCodes.POLICY_VIOLATION,
        "PTY transport open message is invalid.",
      );
      return;
    }

    const ownerResolution = await this.input.sandboxOwnerResolver.resolveOwner({
      sandboxInstanceId: input.admission.claims.sub,
    });
    if (ownerResolution.kind === "missing") {
      throw new BootstrapTunnelNotConnectedError(input.admission.claims.sub);
    }

    input.session.clientOpenRequested = true;
    const sandboxToken = await mintPtyTransportToken({
      config: this.input.tokenConfig,
      claims: {
        sub: input.admission.claims.sub,
        organizationId: input.admission.claims.organizationId,
        ptySessionId: input.admission.claims.ptySessionId,
        role: PtyTransportTokenRoles.SANDBOX,
      },
      ttlSeconds: SandboxTransportTokenTtlSeconds,
    });

    const ptySessionOpen = createPtySessionOpenMessage({
      launch: open.launch,
      ptySessionId: input.admission.claims.ptySessionId,
      transportToken: sandboxToken.token,
      transportUrl: createSandboxTransportUrl({
        config: this.input.config,
        testEnvironmentId: input.testEnvironmentId,
        testEnvironmentIdQueryParam: input.testEnvironmentIdQueryParam,
        token: sandboxToken.token,
      }),
    });

    await this.input.relayCoordinator.forwardPeerMessage({
      sandboxInstanceId: input.admission.claims.sub,
      fromSide: "connection",
      targetSessionId: ownerResolution.owner.sessionId,
      payload: JSON.stringify(ptySessionOpen),
    });
  }

  private closePeer(input: {
    sandboxInstanceId: string;
    targetSide: "ptyClient" | "ptySandbox";
    targetSessionId: string;
    closeCode: number;
    closeReason: string;
  }): void {
    void this.input.relayCoordinator.closeSessionPeer(input).catch(() => undefined);
  }
}

function createPtySessionOpenMessage(input: {
  launch: PtySessionLaunch;
  ptySessionId: string;
  transportToken: string;
  transportUrl: string;
}): PtySessionOpen {
  return {
    type: "pty.session.open",
    requestId: `pty_${randomUUID()}`,
    ptySessionId: input.ptySessionId,
    transportUrl: input.transportUrl,
    transportToken: input.transportToken,
    launch: input.launch,
  };
}

function createSandboxTransportUrl(input: {
  config: DataPlaneGatewayConfig["sandbox"];
  testEnvironmentId: string | undefined;
  testEnvironmentIdQueryParam: string | undefined;
  token: string;
}): string {
  const url = new URL(input.config.internalGatewayWsUrl);
  url.pathname = PtyTransportWebSocketRoutePath;
  url.search = "";
  url.searchParams.set(PtyTransportTokenQueryParam, input.token);
  if (input.testEnvironmentId !== undefined && input.testEnvironmentIdQueryParam !== undefined) {
    url.searchParams.set(input.testEnvironmentIdQueryParam, input.testEnvironmentId);
  }

  return url.toString();
}

function createSessionKey(claims: Pick<VerifiedPtyTransportToken, "sub" | "ptySessionId">): string {
  return `${claims.sub}:${claims.ptySessionId}`;
}

function sendWebSocketMessage(input: {
  message: WSMessageReceive;
  receiver: WSContext<WebSocket>;
}): void {
  if (input.receiver.readyState !== WebSocket.OPEN) {
    return;
  }

  if (typeof input.message === "string") {
    input.receiver.send(input.message);
    return;
  }
  if (input.message instanceof ArrayBuffer) {
    input.receiver.send(input.message);
    return;
  }
  if (input.message instanceof SharedArrayBuffer) {
    const copy = new Uint8Array(input.message.byteLength);
    copy.set(new Uint8Array(input.message));
    input.receiver.send(copy.buffer);
    return;
  }

  void input.message.arrayBuffer().then(
    (buffer) => {
      if (input.receiver.readyState === WebSocket.OPEN) {
        input.receiver.send(buffer);
      }
    },
    (_error: unknown) => {
      input.receiver.close(
        WebSocketCloseCodes.INTERNAL_ERROR,
        "PTY transport binary message could not be read.",
      );
    },
  );
}

async function toRelayPayload(message: WSMessageReceive): Promise<RelayPayload> {
  if (typeof message === "string") {
    return message;
  }
  if (message instanceof ArrayBuffer) {
    return message;
  }
  if (message instanceof SharedArrayBuffer) {
    const copy = new Uint8Array(message.byteLength);
    copy.set(new Uint8Array(message));
    return copy.buffer;
  }

  return message.arrayBuffer();
}

function normalizeForwardedCloseCode(closeCode: number): number {
  if (closeCode === 1005 || closeCode === 1006 || closeCode < 1000 || closeCode >= 5000) {
    return WebSocketCloseCodes.INTERNAL_ERROR;
  }

  return closeCode;
}
