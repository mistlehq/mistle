import type { SandboxOwnerResolution } from "./types.js";

export interface SandboxOwnerResolver {
  resolveOwner(input: { sandboxInstanceId: string }): Promise<SandboxOwnerResolution>;
}
