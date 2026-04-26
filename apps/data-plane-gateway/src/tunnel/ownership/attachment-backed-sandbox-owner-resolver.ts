import type { Clock } from "@mistle/time";

import type { ActiveBootstrapSessionStore } from "../../runtime-state/active-bootstrap-session-store.js";
import type { SandboxOwnerResolver } from "./sandbox-owner-resolver.js";
import type { SandboxOwnerResolution } from "./types.js";

/**
 * Resolves sandbox ownership from the current attached bootstrap session.
 *
 * This bridges remaining owner-shaped consumers while active authority is
 * migrated away from the separate owner lease store.
 */
export class AttachmentBackedSandboxOwnerResolver implements SandboxOwnerResolver {
  public constructor(
    private readonly nodeId: string,
    private readonly activeBootstrapSessionStore: ActiveBootstrapSessionStore,
    private readonly clock: Clock,
  ) {}

  public async resolveOwner(input: { sandboxInstanceId: string }): Promise<SandboxOwnerResolution> {
    const activeSession = await this.activeBootstrapSessionStore.getActiveSession({
      sandboxInstanceId: input.sandboxInstanceId,
      nowMs: this.clock.nowMs(),
    });
    if (activeSession === null) {
      return { kind: "missing" };
    }

    const owner = {
      sandboxInstanceId: activeSession.sandboxInstanceId,
      nodeId: activeSession.nodeId,
      sessionId: activeSession.sessionId,
      leaseId: activeSession.ownerLeaseId,
      expiresAt: new Date(activeSession.attachedAtMs),
    };

    if (owner.nodeId === this.nodeId) {
      return {
        kind: "local",
        owner,
      };
    }

    return {
      kind: "remote",
      owner,
    };
  }
}
