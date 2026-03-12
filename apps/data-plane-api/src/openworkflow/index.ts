import { OpenWorkflow } from "openworkflow";
import { BackendPostgres } from "openworkflow/postgres";

export const DataPlaneOpenWorkflowSchema = "data_plane_openworkflow";

export type CreateDataPlaneBackendInput = {
  url: string;
  namespaceId: string;
  runMigrations: boolean;
};

export async function createDataPlaneBackend(
  input: CreateDataPlaneBackendInput,
): Promise<BackendPostgres> {
  return BackendPostgres.connect(input.url, {
    namespaceId: input.namespaceId,
    runMigrations: input.runMigrations,
    schema: DataPlaneOpenWorkflowSchema,
  });
}

export type CreateDataPlaneOpenWorkflowInput = {
  backend: BackendPostgres;
};

export function createDataPlaneOpenWorkflow(input: CreateDataPlaneOpenWorkflowInput): OpenWorkflow {
  return new OpenWorkflow({
    backend: input.backend,
  });
}
