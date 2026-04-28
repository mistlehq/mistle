import type { PoolClient } from "pg";

export class MaintenanceLockUnavailableError extends Error {
  constructor(commandName: string) {
    super(`Maintenance command '${commandName}' is already running.`);
    this.name = "MaintenanceLockUnavailableError";
  }
}

const MaintenanceAdvisoryLockNamespace = 20_260_429;

export async function acquireMaintenanceAdvisoryLock(input: {
  client: PoolClient;
  commandName: string;
}): Promise<void> {
  const result = await input.client.query<{ acquired: boolean }>({
    text: "select pg_try_advisory_lock($1, hashtext($2)) as acquired",
    values: [MaintenanceAdvisoryLockNamespace, input.commandName],
  });
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Expected PostgreSQL advisory lock query to return a row.");
  }

  if (!row.acquired) {
    throw new MaintenanceLockUnavailableError(input.commandName);
  }
}

export async function releaseMaintenanceAdvisoryLock(input: {
  client: PoolClient;
  commandName: string;
}): Promise<void> {
  await input.client.query({
    text: "select pg_advisory_unlock($1, hashtext($2))",
    values: [MaintenanceAdvisoryLockNamespace, input.commandName],
  });
}
