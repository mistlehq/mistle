import type { RelayTarget } from "../../types.js";
import { SandboxTunnelSession, type ClientStreamBinding } from "../sandbox-tunnel-session.js";
import type {
  AttachBootstrapSessionResult,
  DetachBootstrapSessionResult,
  TunnelSessionRegistryAdapter,
} from "../tunnel-session-registry-adapter.js";

function isSameBootstrapTarget(left: RelayTarget, right: RelayTarget): boolean {
  return (
    left.sandboxInstanceId === right.sandboxInstanceId &&
    left.side === right.side &&
    left.nodeId === right.nodeId &&
    left.sessionId === right.sessionId
  );
}

/**
 * In-memory tunnel session registry for the current gateway node.
 *
 * This implementation intentionally keeps live tunnel session state local to the owner
 * node. Distributed routing should forward to the owner node rather than attempting to
 * share these live session objects across nodes.
 */
export class InMemoryTunnelSessionRegistryAdapter implements TunnelSessionRegistryAdapter {
  readonly #sessionsBySandboxInstanceId = new Map<string, SandboxTunnelSession>();

  public constructor(private readonly maxBindingCount = 1) {}

  public attachBootstrapSession(input: RelayTarget): AttachBootstrapSessionResult {
    const replacedSession = this.#sessionsBySandboxInstanceId.get(input.sandboxInstanceId);
    const session = new SandboxTunnelSession(input, this.maxBindingCount);
    this.#sessionsBySandboxInstanceId.set(input.sandboxInstanceId, session);

    return {
      replacedBootstrapTarget: replacedSession?.bootstrapTarget,
      releasedBindings: replacedSession?.releaseAllBindings() ?? [],
    };
  }

  public getBootstrapTarget(input: { sandboxInstanceId: string }): RelayTarget | undefined {
    return this.#sessionsBySandboxInstanceId.get(input.sandboxInstanceId)?.bootstrapTarget;
  }

  public detachBootstrapSession(input: RelayTarget): DetachBootstrapSessionResult | undefined {
    const currentSession = this.#sessionsBySandboxInstanceId.get(input.sandboxInstanceId);
    if (currentSession === undefined) {
      return undefined;
    }

    if (!isSameBootstrapTarget(currentSession.bootstrapTarget, input)) {
      return undefined;
    }

    this.#sessionsBySandboxInstanceId.delete(input.sandboxInstanceId);
    return {
      bootstrapTarget: currentSession.bootstrapTarget,
      releasedBindings: currentSession.releaseAllBindings(),
    };
  }

  public bindClientStream(input: {
    sandboxInstanceId: string;
    channelKind: "agent" | "pty";
    clientSessionId: string;
    clientStreamId: number;
  }): ClientStreamBinding {
    const session = this.#sessionsBySandboxInstanceId.get(input.sandboxInstanceId);
    if (session === undefined) {
      throw new Error(
        `Bootstrap tunnel session is not registered for sandbox '${input.sandboxInstanceId}'.`,
      );
    }

    return session.bindClientStream({
      channelKind: input.channelKind,
      clientSessionId: input.clientSessionId,
      clientStreamId: input.clientStreamId,
    });
  }

  public getBindingByClientStream(input: {
    sandboxInstanceId: string;
    clientSessionId: string;
    clientStreamId: number;
  }): ClientStreamBinding | undefined {
    return this.#sessionsBySandboxInstanceId
      .get(input.sandboxInstanceId)
      ?.getBindingByClientStream({
        clientSessionId: input.clientSessionId,
        clientStreamId: input.clientStreamId,
      });
  }

  public getBindingByTunnelStreamId(input: {
    sandboxInstanceId: string;
    tunnelStreamId: number;
  }): ClientStreamBinding | undefined {
    return this.#sessionsBySandboxInstanceId
      .get(input.sandboxInstanceId)
      ?.getBindingByTunnelStreamId(input.tunnelStreamId);
  }

  public unbindClientStream(input: {
    sandboxInstanceId: string;
    clientSessionId: string;
    clientStreamId: number;
  }): ClientStreamBinding | undefined {
    return this.#sessionsBySandboxInstanceId.get(input.sandboxInstanceId)?.unbindClientStream({
      clientSessionId: input.clientSessionId,
      clientStreamId: input.clientStreamId,
    });
  }

  public releaseClientSessionBindings(input: {
    sandboxInstanceId: string;
    clientSessionId: string;
  }): ClientStreamBinding[] {
    const session = this.#sessionsBySandboxInstanceId.get(input.sandboxInstanceId);
    if (session === undefined) {
      return [];
    }

    return session.releaseClientSessionBindings({
      clientSessionId: input.clientSessionId,
    });
  }
}
