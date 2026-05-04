import { SandboxRuntimeStateSnapshotSchema } from "@mistle/sandbox-runtime-contract";

import type {
  SandboxRuntimeStateReader,
  SandboxRuntimeStateSnapshot,
} from "./sandbox-runtime-state-reader.js";

const DefaultRequestTimeoutMs = 3_000;
const DataPlaneInternalAuthHeader = "x-mistle-service-token";

/**
 * Reads runtime-state snapshots from the gateway's internal HTTP route.
 *
 * Gateway remains the sole owner of the runtime-state backend choice, so
 * data-plane API reads owner/attachment and presence/keepalive summaries
 * through the gateway
 * regardless of whether gateway uses `memory` or `valkey`.
 */
export class GatewayHttpSandboxRuntimeStateReader implements SandboxRuntimeStateReader {
  public constructor(
    private readonly input: {
      baseUrl: string;
      serviceToken: string;
      testEnvironmentId?: string;
      testEnvironmentIdHeader?: string;
      requestTimeoutMs?: number;
    },
  ) {}

  /**
   * Reads the latest runtime-state snapshot for one sandbox instance.
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
      headers: this.createHeaders(),
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

  private createHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      [DataPlaneInternalAuthHeader]: this.input.serviceToken,
    };

    if (
      this.input.testEnvironmentId !== undefined &&
      this.input.testEnvironmentIdHeader !== undefined
    ) {
      headers[this.input.testEnvironmentIdHeader] = this.input.testEnvironmentId;
    }

    return headers;
  }
}
