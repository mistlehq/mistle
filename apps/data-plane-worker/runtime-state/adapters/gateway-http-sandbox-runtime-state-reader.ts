import { SandboxRuntimeStateSnapshotSchema } from "@mistle/sandbox-runtime-contract";

import type {
  SandboxRuntimeStateReader,
  SandboxRuntimeStateSnapshot,
} from "../sandbox-runtime-state-reader.js";

const DefaultRequestTimeoutMs = 3_000;
const DataPlaneInternalAuthHeader = "x-mistle-service-token";

/**
 * Reads worker runtime-state snapshots through the gateway's internal HTTP API.
 *
 * This adapter always authenticates with the shared internal service token. The
 * gateway owns the runtime-state backend choice, so worker callers never branch
 * on `memory` versus `valkey`. Snapshots include owner/attachment and
 * presence/keepalive summaries.
 */
export class GatewayHttpSandboxRuntimeStateReader implements SandboxRuntimeStateReader {
  public constructor(
    private readonly input: {
      baseUrl: string;
      serviceToken: string;
      requestTimeoutMs?: number;
    },
  ) {}

  /**
   * Reads the latest worker-visible runtime-state snapshot for one sandbox.
   */
  public async readSnapshot({
    sandboxInstanceId,
  }: {
    sandboxInstanceId: string;
    nowMs: number;
  }): Promise<SandboxRuntimeStateSnapshot> {
    const url = new URL(
      `/internal/sandbox-instances/${encodeURIComponent(sandboxInstanceId)}/runtime-state`,
      this.input.baseUrl,
    );
    const response = await fetch(url, {
      headers: {
        [DataPlaneInternalAuthHeader]: this.input.serviceToken,
      },
      signal: AbortSignal.timeout(this.input.requestTimeoutMs ?? DefaultRequestTimeoutMs),
    });

    if (!response.ok) {
      throw new Error(
        `Gateway runtime-state read failed with status ${String(response.status)} for sandbox '${sandboxInstanceId}'.`,
      );
    }

    const json = await response.json();
    return SandboxRuntimeStateSnapshotSchema.parse(json);
  }
}
