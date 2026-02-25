import type { BackendPostgres } from "openworkflow/postgres";

import { createOpenWorkflowBackend } from "../core/create-backend.js";
import { DataPlaneOpenWorkflow } from "./constants.js";

export type CreateDataPlaneBackendInput = {
  url: string;
  namespaceId: string;
  runMigrations: boolean;
};

/**
 * Creates the data-plane OpenWorkflow backend using a dedicated schema.
 * This prevents data-plane and control-plane migrations from colliding.
 */
export async function createDataPlaneBackend(
  input: CreateDataPlaneBackendInput,
): Promise<BackendPostgres> {
  return createOpenWorkflowBackend({
    url: input.url,
    namespaceId: input.namespaceId,
    runMigrations: input.runMigrations,
    schema: DataPlaneOpenWorkflow.SCHEMA,
  });
}
