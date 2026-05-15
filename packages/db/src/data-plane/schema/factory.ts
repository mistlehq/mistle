import { pgSchema } from "drizzle-orm/pg-core";

import { defineSandboxInstanceDeadlines } from "./sandbox-instance-deadlines.js";
import { defineSandboxInstanceRuntimePlans } from "./sandbox-instance-runtime-plans.js";
import { defineSandboxInstanceStorages } from "./sandbox-instance-storages.js";
import { defineSandboxInstances } from "./sandbox-instances.js";
import { defineSandboxOperationEvents } from "./sandbox-operation-events.js";
import { defineSandboxTunnelTokenRedemptions } from "./sandbox-tunnel-token-redemptions.js";

/**
 * Creates data-plane table objects bound to a specific Postgres schema.
 *
 * The default exported table objects remain bound to `data_plane`. Test
 * environments use this factory to create the same typed table graph against a
 * throwaway schema inside a shared physical Postgres database.
 */
export function createDataPlaneDbSchema(schemaName: string) {
  const schema = pgSchema(schemaName);
  const sandboxInstances = defineSandboxInstances(schema);

  return {
    sandboxInstanceDeadlines: defineSandboxInstanceDeadlines({
      schema,
      sandboxInstances,
    }),
    sandboxInstanceRuntimePlans: defineSandboxInstanceRuntimePlans({
      schema,
      sandboxInstances,
    }),
    sandboxInstanceStorages: defineSandboxInstanceStorages({
      schema,
      sandboxInstances,
    }),
    sandboxInstances,
    sandboxOperationEvents: defineSandboxOperationEvents({
      schema,
      sandboxInstances,
    }),
    sandboxTunnelTokenRedemptions: defineSandboxTunnelTokenRedemptions(schema),
  };
}

export type DataPlaneDbSchema = ReturnType<typeof createDataPlaneDbSchema>;
