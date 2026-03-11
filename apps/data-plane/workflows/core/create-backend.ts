import { BackendPostgres } from "openworkflow/postgres";

export type CreateOpenWorkflowBackendInput = {
  url: string;
  namespaceId: string;
  runMigrations: boolean;
  schema: string;
};

/**
 * Creates a Postgres-backed OpenWorkflow backend.
 */
export async function createOpenWorkflowBackend(
  input: CreateOpenWorkflowBackendInput,
): Promise<BackendPostgres> {
  return BackendPostgres.connect(input.url, {
    namespaceId: input.namespaceId,
    runMigrations: input.runMigrations,
    schema: input.schema,
  });
}
