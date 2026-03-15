import type { DataPlaneDatabase } from "@mistle/db/data-plane";

export type ReadSandboxExecutionLeaseStateInput = {
  sandboxInstanceId: string;
  freshSince: string;
};

export type ReadSandboxExecutionLeaseStateOutput = {
  newestLastSeenAt: string | null;
  hasFreshExecutionLease: boolean;
};

function normalizeTimestamp(timestamp: string): string {
  const parsedTimestampMs = Date.parse(timestamp);

  if (Number.isNaN(parsedTimestampMs)) {
    throw new Error("Expected execution lease timestamp to be a valid ISO-8601 timestamp.");
  }

  return new Date(parsedTimestampMs).toISOString();
}

export async function readSandboxExecutionLeaseState(
  deps: {
    db: DataPlaneDatabase;
  },
  input: ReadSandboxExecutionLeaseStateInput,
): Promise<ReadSandboxExecutionLeaseStateOutput> {
  if (input.sandboxInstanceId.trim().length === 0) {
    throw new Error("Expected sandbox instance id to be non-empty when reading execution leases.");
  }
  if (input.freshSince.trim().length === 0) {
    throw new Error("Expected freshSince to be non-empty when reading execution leases.");
  }
  if (Number.isNaN(Date.parse(input.freshSince))) {
    throw new Error("Expected freshSince to be a valid ISO-8601 timestamp.");
  }

  const newestExecutionLease = await deps.db.query.sandboxExecutionLeases.findFirst({
    columns: {
      lastSeenAt: true,
    },
    where: (table, { eq: whereEq }) => whereEq(table.sandboxInstanceId, input.sandboxInstanceId),
    orderBy: (table, { desc }) => [desc(table.lastSeenAt)],
  });

  const freshExecutionLease = await deps.db.query.sandboxExecutionLeases.findFirst({
    columns: {
      id: true,
    },
    where: (table, { and, eq: whereEq, gte }) =>
      and(
        whereEq(table.sandboxInstanceId, input.sandboxInstanceId),
        gte(table.lastSeenAt, input.freshSince),
      ),
    orderBy: (table, { desc }) => [desc(table.lastSeenAt)],
  });

  return {
    newestLastSeenAt:
      newestExecutionLease === undefined
        ? null
        : normalizeTimestamp(newestExecutionLease.lastSeenAt),
    hasFreshExecutionLease: freshExecutionLease !== undefined,
  };
}
