import { OpenWorkflow } from "openworkflow";
import { BackendPostgres } from "openworkflow/postgres";

export const ControlPlaneOpenWorkflowSchema = "control_plane_openworkflow";

export type CreateControlPlaneBackendInput = {
  url: string;
  namespaceId: string;
  runMigrations: boolean;
};

export async function createControlPlaneBackend(
  input: CreateControlPlaneBackendInput,
): Promise<BackendPostgres> {
  return BackendPostgres.connect(input.url, {
    namespaceId: input.namespaceId,
    runMigrations: input.runMigrations,
    schema: ControlPlaneOpenWorkflowSchema,
  });
}

export type CreateControlPlaneOpenWorkflowInput = {
  backend: BackendPostgres;
};

export function createControlPlaneOpenWorkflow(
  input: CreateControlPlaneOpenWorkflowInput,
): OpenWorkflow {
  return new OpenWorkflow({
    backend: input.backend,
  });
}
