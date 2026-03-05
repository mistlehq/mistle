import { BackendPostgres } from "openworkflow/postgres";
import postgres from "postgres";

export type CreateOpenWorkflowBackendInput = {
  url: string;
  namespaceId: string;
  runMigrations: boolean;
  schema: string;
};

/**
 * OpenWorkflow currently uses `transform: postgres.toCamel` which also
 * camelizes JSONB object keys via postgres.js value transforms.
 *
 * For workflow inputs this mutates env keys like `OPENAI_MODEL` into
 * `OPENAIMODEL` when runs are read back by workers. Keep column camelization
 * but disable JSON value camelization.
 */
export function configureOpenWorkflowPostgresTransforms(): void {
  const didSetColumn = Reflect.set(postgres.toCamel, "column", {
    from: postgres.toCamel,
  });
  if (!didSetColumn) {
    throw new Error("Failed to configure postgres.toCamel column transform.");
  }

  Reflect.deleteProperty(postgres.toCamel, "value");
}

/**
 * Creates a Postgres-backed OpenWorkflow backend.
 */
export async function createOpenWorkflowBackend(
  input: CreateOpenWorkflowBackendInput,
): Promise<BackendPostgres> {
  configureOpenWorkflowPostgresTransforms();

  return BackendPostgres.connect(input.url, {
    namespaceId: input.namespaceId,
    runMigrations: input.runMigrations,
    schema: input.schema,
  });
}
