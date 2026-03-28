import {
  createDataPlaneSandboxInstancesClient,
  type CreateDataPlaneSandboxInstancesClientInput,
} from "@mistle/data-plane-internal-client";

import type { ReconcileSandboxRequester } from "../idle/reconcile-sandbox-requester.js";

/**
 * Gateway adapter that forwards sandbox reconcile requests through the shared
 * internal data-plane API client.
 *
 * This adapter preserves the caller-supplied idempotency key and
 * `expectedOwnerLeaseId` fence. Authentication is provided by the shared
 * internal client using the global `x-mistle-service-token` header contract.
 */
export class DataPlaneApiReconcileSandboxClient implements ReconcileSandboxRequester {
  readonly #client: ReturnType<typeof createDataPlaneSandboxInstancesClient>;

  constructor(input: CreateDataPlaneSandboxInstancesClientInput) {
    this.#client = createDataPlaneSandboxInstancesClient(input);
  }

  /**
   * Requests sandbox reconciliation through `data-plane-api`.
   */
  async requestReconcile(input: {
    sandboxInstanceId: string;
    reason: "disconnect_grace_elapsed";
    expectedOwnerLeaseId: string;
    idempotencyKey: string;
  }): Promise<void> {
    await this.#client.reconcileSandboxInstance(input);
  }
}
