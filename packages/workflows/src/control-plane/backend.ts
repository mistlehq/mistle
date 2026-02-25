import type { BackendPostgres } from "openworkflow/postgres";

import { createOpenWorkflowBackend } from "../core/create-backend.js";
import { ControlPlaneOpenWorkflow } from "./constants.js";

export type CreateControlPlaneBackendInput = {
  url: string;
  namespaceId: string;
  runMigrations: boolean;
};

/**
 * Creates the control-plane OpenWorkflow backend using a dedicated schema.
 * This prevents control-plane and data-plane migrations from colliding.
 */
export async function createControlPlaneBackend(
  input: CreateControlPlaneBackendInput,
): Promise<BackendPostgres> {
  return createOpenWorkflowBackend({
    url: input.url,
    namespaceId: input.namespaceId,
    runMigrations: input.runMigrations,
    schema: ControlPlaneOpenWorkflow.SCHEMA,
  });
}
