import { injectActiveTraceContextIntoWorkflowRunContext } from "@mistle/telemetry";
import { OpenWorkflow } from "openworkflow";
import { BackendPostgres } from "openworkflow/postgres";
import postgres from "postgres";

export const DataPlaneOpenWorkflowSchema = "data_plane_openworkflow";

export type CreateDataPlaneBackendInput = {
  url: string;
  namespaceId: string;
  runMigrations: boolean;
  databasePoolMax: number;
};

export async function createDataPlaneBackend(
  input: CreateDataPlaneBackendInput,
): Promise<BackendPostgres> {
  if (input.runMigrations) {
    return BackendPostgres.connect(input.url, {
      namespaceId: input.namespaceId,
      runMigrations: input.runMigrations,
      schema: DataPlaneOpenWorkflowSchema,
    });
  }

  const pg = postgres(input.url, {
    max: input.databasePoolMax,
    connection: {
      application_name: "mistle-data-plane-api-openworkflow",
    },
    transform: {
      column: {
        from: postgres.toCamel,
      },
    },
  });

  return BackendPostgres.fromPool(pg, {
    namespaceId: input.namespaceId,
    schema: DataPlaneOpenWorkflowSchema,
  });
}

export type CreateDataPlaneOpenWorkflowInput = {
  backend: BackendPostgres;
};

function createTracingBackend(backend: BackendPostgres): BackendPostgres {
  return new Proxy(backend, {
    get(target, property, receiver) {
      if (property === "createWorkflowRun") {
        return async (...args: Parameters<BackendPostgres["createWorkflowRun"]>) => {
          const [params] = args;

          return target.createWorkflowRun({
            ...params,
            context: injectActiveTraceContextIntoWorkflowRunContext(params.context),
          });
        };
      }

      const value = Reflect.get(target, property, receiver);
      if (typeof value === "function") {
        return value.bind(target);
      }

      return value;
    },
  });
}

export function createDataPlaneOpenWorkflow(input: CreateDataPlaneOpenWorkflowInput): OpenWorkflow {
  return new OpenWorkflow({
    backend: createTracingBackend(input.backend),
  });
}
