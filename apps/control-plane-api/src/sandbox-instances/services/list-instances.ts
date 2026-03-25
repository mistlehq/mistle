import {
  DataPlaneSandboxInstancesClientError,
  type DataPlaneSandboxInstancesClient,
  type ListSandboxInstancesResponse,
} from "@mistle/data-plane-internal-client";
import type { ControlPlaneDatabase } from "@mistle/db/control-plane";

import { resolveUserDisplayName } from "../../lib/user-display-name.js";
import { SandboxInstancesBadRequestCodes, SandboxInstancesBadRequestError } from "../errors.js";
import type { ListSandboxInstancesResult } from "./types.js";

async function resolveStartedByNames(
  db: ControlPlaneDatabase,
  input: ListSandboxInstancesResponse["items"],
): Promise<Map<string, string>> {
  const startedByUserIds = [
    ...new Set(
      input
        .map((item) => item.startedBy)
        .filter((starter) => starter.kind === "user")
        .map((starter) => starter.id),
    ),
  ];
  if (startedByUserIds.length === 0) {
    return new Map();
  }

  const users = await db.query.users.findMany({
    columns: {
      id: true,
      name: true,
      email: true,
    },
    where: (table, { inArray }) => inArray(table.id, startedByUserIds),
  });

  return new Map(
    users.map((user) => [
      user.id,
      resolveUserDisplayName({
        name: user.name,
        email: user.email,
      }),
    ]),
  );
}

async function resolveSandboxProfileDisplayNames(
  db: ControlPlaneDatabase,
  input: {
    organizationId: string;
    items: ListSandboxInstancesResponse["items"];
  },
): Promise<Map<string, string>> {
  const sandboxProfileIds = [...new Set(input.items.map((item) => item.sandboxProfileId))];
  if (sandboxProfileIds.length === 0) {
    return new Map();
  }

  const sandboxProfiles = await db.query.sandboxProfiles.findMany({
    columns: {
      id: true,
      displayName: true,
    },
    where: (table, { and, eq, inArray }) =>
      and(eq(table.organizationId, input.organizationId), inArray(table.id, sandboxProfileIds)),
  });

  return new Map(
    sandboxProfiles.map((sandboxProfile) => [sandboxProfile.id, sandboxProfile.displayName]),
  );
}

export async function listInstances(
  {
    db,
    dataPlaneClient,
  }: {
    db: ControlPlaneDatabase;
    dataPlaneClient: DataPlaneSandboxInstancesClient;
  },
  input: {
    organizationId: string;
    limit?: number;
    after?: string;
    before?: string;
  },
): Promise<ListSandboxInstancesResult> {
  try {
    const sandboxInstances = await dataPlaneClient.listSandboxInstances({
      organizationId: input.organizationId,
      ...(input.limit === undefined ? {} : { limit: input.limit }),
      ...(input.after === undefined ? {} : { after: input.after }),
      ...(input.before === undefined ? {} : { before: input.before }),
    });

    const startedByNames = await resolveStartedByNames(db, sandboxInstances.items);
    const sandboxProfileDisplayNames = await resolveSandboxProfileDisplayNames(db, {
      organizationId: input.organizationId,
      items: sandboxInstances.items,
    });

    return {
      ...sandboxInstances,
      items: sandboxInstances.items.map((item) => ({
        ...item,
        sandboxProfileDisplayName: sandboxProfileDisplayNames.get(item.sandboxProfileId) ?? null,
        startedBy: {
          ...item.startedBy,
          name:
            item.startedBy.kind === "user" ? (startedByNames.get(item.startedBy.id) ?? null) : null,
        },
      })),
    };
  } catch (error) {
    if (error instanceof DataPlaneSandboxInstancesClientError && error.status === 400) {
      throw new SandboxInstancesBadRequestError(
        SandboxInstancesBadRequestCodes.INVALID_LIST_INSTANCES_INPUT,
        error.body?.message ?? error.message,
      );
    }

    throw error;
  }
}
