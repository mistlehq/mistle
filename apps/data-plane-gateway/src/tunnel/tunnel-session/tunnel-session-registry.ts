import type { RelayTarget } from "../types.js";
import { SandboxTunnelSession } from "./sandbox-tunnel-session.js";

function isSameBootstrapTarget(left: RelayTarget, right: RelayTarget): boolean {
  return (
    left.sandboxInstanceId === right.sandboxInstanceId &&
    left.side === right.side &&
    left.nodeId === right.nodeId &&
    left.sessionId === right.sessionId
  );
}

export class TunnelSessionRegistry {
  readonly #sessionsBySandboxInstanceId = new Map<string, SandboxTunnelSession>();

  public attachBootstrapSession(input: RelayTarget): {
    session: SandboxTunnelSession;
    replacedSession: SandboxTunnelSession | undefined;
  } {
    const replacedSession = this.#sessionsBySandboxInstanceId.get(input.sandboxInstanceId);
    const session = new SandboxTunnelSession(input);
    this.#sessionsBySandboxInstanceId.set(input.sandboxInstanceId, session);
    return {
      session,
      replacedSession,
    };
  }

  public getBootstrapSession(input: {
    sandboxInstanceId: string;
  }): SandboxTunnelSession | undefined {
    return this.#sessionsBySandboxInstanceId.get(input.sandboxInstanceId);
  }

  public detachBootstrapSession(input: RelayTarget): SandboxTunnelSession | undefined {
    const currentSession = this.#sessionsBySandboxInstanceId.get(input.sandboxInstanceId);
    if (currentSession === undefined) {
      return undefined;
    }

    if (!isSameBootstrapTarget(currentSession.bootstrapTarget, input)) {
      return undefined;
    }

    this.#sessionsBySandboxInstanceId.delete(input.sandboxInstanceId);
    return currentSession;
  }
}
