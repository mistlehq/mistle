import type { SandboxOwnerResolver } from "./sandbox-owner-resolver.js";
import type { SandboxOwnerStore } from "./sandbox-owner-store.js";
import type { SandboxOwnerResolution } from "./types.js";

export class StoreBackedSandboxOwnerResolver implements SandboxOwnerResolver {
  public constructor(
    private readonly nodeId: string,
    private readonly sandboxOwnerStore: SandboxOwnerStore,
  ) {}

  public async resolveOwner(input: { sandboxInstanceId: string }): Promise<SandboxOwnerResolution> {
    const owner = await this.sandboxOwnerStore.getOwner({
      sandboxInstanceId: input.sandboxInstanceId,
    });
    if (owner === undefined) {
      return { kind: "missing" };
    }
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
