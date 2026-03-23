import { z } from "zod";

import type {
  SandboxRuntimeStateReader,
  SandboxRuntimeStateSnapshot,
} from "./sandbox-runtime-state-reader.js";

const DefaultRequestTimeoutMs = 3_000;
const DataPlaneInternalAuthHeader = "x-mistle-service-token";

const SandboxRuntimeAttachmentSchema = z
  .object({
    sandboxInstanceId: z.string().min(1),
    ownerLeaseId: z.string().min(1),
    nodeId: z.string().min(1),
    sessionId: z.string().min(1),
    attachedAtMs: z.number().int().nonnegative(),
  })
  .strict();

const SandboxRuntimeStateSnapshotSchema = z
  .object({
    ownerLeaseId: z.string().min(1).nullable(),
    attachment: SandboxRuntimeAttachmentSchema.nullable(),
  })
  .strict();

/**
 * Reads runtime-state snapshots from the gateway's internal HTTP route.
 *
 * Gateway remains the sole owner of the runtime-state backend choice, so
 * data-plane API reads owner and attachment state through the gateway
 * regardless of whether gateway uses `memory` or `valkey`.
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
   * Reads the latest runtime-state snapshot for one sandbox instance.
   */
  public async readSnapshot(input: {
    sandboxInstanceId: string;
    nowMs: number;
  }): Promise<SandboxRuntimeStateSnapshot> {
    void input.nowMs;

    const url = new URL(
      `/internal/sandbox-instances/${encodeURIComponent(input.sandboxInstanceId)}/runtime-state`,
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
        `Gateway runtime-state read failed with status ${String(response.status)} for sandbox '${input.sandboxInstanceId}'.`,
      );
    }

    const json = await response.json();
    return SandboxRuntimeStateSnapshotSchema.parse(json);
  }
}
