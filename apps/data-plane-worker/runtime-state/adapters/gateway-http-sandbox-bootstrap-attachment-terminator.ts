import { z } from "zod";

import type {
  SandboxBootstrapAttachmentTerminator,
  TerminateSandboxBootstrapAttachmentResult,
} from "../sandbox-bootstrap-attachment-terminator.js";

const DefaultRequestTimeoutMs = 3_000;
const DataPlaneInternalAuthHeader = "x-mistle-service-token";

const TerminateSandboxBootstrapAttachmentResultSchema = z
  .object({
    outcome: z.enum(["terminated", "closed", "not_attached", "fence_mismatch"]),
  })
  .strict();

export class GatewayHttpSandboxBootstrapAttachmentTerminator implements SandboxBootstrapAttachmentTerminator {
  public constructor(
    private readonly input: {
      baseUrl: string;
      serviceToken: string;
      testEnvironmentId?: string;
      testEnvironmentIdHeader?: string;
      requestTimeoutMs?: number;
    },
  ) {}

  public async terminate(input: {
    sandboxInstanceId: string;
    expectedOwnerLeaseId: string;
    expectedSessionId?: string;
  }): Promise<TerminateSandboxBootstrapAttachmentResult> {
    const url = new URL(
      `/internal/sandbox-instances/${encodeURIComponent(input.sandboxInstanceId)}/bootstrap-attachment/terminate`,
      this.input.baseUrl,
    );
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...this.#headers(),
      },
      body: JSON.stringify({
        expectedOwnerLeaseId: input.expectedOwnerLeaseId,
        ...(input.expectedSessionId === undefined
          ? {}
          : { expectedSessionId: input.expectedSessionId }),
      }),
      signal: AbortSignal.timeout(this.input.requestTimeoutMs ?? DefaultRequestTimeoutMs),
    });

    const json: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(
        `Gateway bootstrap attachment termination failed with status ${String(response.status)} for sandbox '${input.sandboxInstanceId}'. Response body: ${JSON.stringify(json)}`,
      );
    }

    return TerminateSandboxBootstrapAttachmentResultSchema.parse(json);
  }

  #headers(): Record<string, string> {
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
