import {
  createDataPlaneSandboxInstancesClient,
  type CreateDataPlaneSandboxInstancesClientInput,
} from "@mistle/data-plane-internal-client";

import type { StopSandboxRequester } from "../idle/stop-sandbox-requester.js";

/**
 * Gateway adapter that forwards sandbox stop requests through the shared
 * internal data-plane API client.
 *
 * This adapter preserves the caller-supplied idempotency key and
 * `expectedOwnerLeaseId` fence. Authentication is provided by the shared
 * internal client using the global `x-mistle-service-token` header contract.
 */
export class DataPlaneApiStopSandboxClient implements StopSandboxRequester {
  readonly #client: ReturnType<typeof createDataPlaneSandboxInstancesClient>;

  constructor(input: CreateDataPlaneSandboxInstancesClientInput) {
    this.#client = createDataPlaneSandboxInstancesClient(input);
  }

  /**
   * Requests a sandbox stop through `data-plane-api`.
   */
  async requestStop(input: {
    sandboxInstanceId: string;
    stopReason: "idle" | "disconnected";
    expectedOwnerLeaseId: string;
    idempotencyKey: string;
  }): Promise<void> {
    await this.#client.stopSandboxInstance(input);
  }
}
